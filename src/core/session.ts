import { dirname, resolve } from "node:path";
import type { BuildMode, BuildResult, LatextifierSettings } from "../types";
import { ProjectCompiler } from "./compiler";

export type SessionEvent =
  | { type: "start"; mode: BuildMode }
  | { type: "result"; result: BuildResult }
  | { type: "failure"; error: Error };

export class LatexSession {
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  readonly compiler: ProjectCompiler;
  lastResult: BuildResult | null = null;

  constructor(
    readonly root: string,
    settings: () => LatextifierSettings
  ) {
    this.compiler = new ProjectCompiler(root, settings, {
      onStart: (mode) => this.emit({ type: "start", mode }),
      onResult: (result) => {
        if (result.ok) this.lastResult = result;
        this.emit({ type: "result", result });
      },
      onFailure: (error) => this.emit({ type: "failure", error })
    });
  }

  request(mode: BuildMode): void {
    this.compiler.request(mode);
  }

  on(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  usesPath(path: string): boolean {
    const absolute = resolve(path);
    return absolute === resolve(this.root)
      || this.compiler.dependencies.has(absolute)
      || absolute.startsWith(resolve(dirname(this.root)) + "/");
  }

  dispose(): void {
    this.compiler.dispose();
    this.listeners.clear();
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export class SessionRegistry {
  private readonly entries = new Map<string, { session: LatexSession; refs: number }>();

  constructor(private readonly settings: () => LatextifierSettings) {}

  acquire(root: string): LatexSession {
    const key = resolve(root);
    const existing = this.entries.get(key);
    if (existing) {
      existing.refs += 1;
      return existing.session;
    }
    const session = new LatexSession(key, this.settings);
    this.entries.set(key, { session, refs: 1 });
    return session;
  }

  release(root: string): void {
    const key = resolve(root);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      entry.session.dispose();
      this.entries.delete(key);
    }
  }

  notifyChanged(path: string): void {
    for (const entry of this.entries.values()) {
      if (entry.session.usesPath(path)) entry.session.request("fast");
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.session.dispose();
    this.entries.clear();
  }
}
