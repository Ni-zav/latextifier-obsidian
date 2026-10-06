import { dirname, resolve, sep } from "node:path";
import type { BuildMode, BuildResult, Diagnostic, LatextifierSettings } from "../types";
import { ProjectCompiler } from "./compiler";
import { ProjectIndex, type ProjectSnapshot } from "./project-index";
import { TexlabClient } from "./texlab";

export type SessionEvent =
  | { type: "start"; mode: BuildMode }
  | { type: "result"; result: BuildResult }
  | { type: "index"; snapshot: ProjectSnapshot }
  | { type: "texlab-diagnostics"; file: string; diagnostics: Diagnostic[] }
  | { type: "texlab-status"; status: "starting" | "ready" | "unavailable" | "stopped" }
  | { type: "failure"; error: Error };

export class LatexSession {
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  readonly compiler: ProjectCompiler;
  readonly index: ProjectIndex;
  readonly texlab: TexlabClient;
  readonly texlabDiagnostics = new Map<string, Diagnostic[]>();
  lastResult: BuildResult | null = null;

  constructor(
    readonly root: string,
    settings: () => LatextifierSettings
  ) {
    this.index = new ProjectIndex(root);
    this.texlab = new TexlabClient(root, settings, {
      onDiagnostics: (file, diagnostics) => {
        this.texlabDiagnostics.set(resolve(file), diagnostics);
        this.emit({ type: "texlab-diagnostics", file: resolve(file), diagnostics });
      },
      onStatus: (status) => this.emit({ type: "texlab-status", status })
    });

    this.compiler = new ProjectCompiler(root, settings, {
      onStart: (mode) => this.emit({ type: "start", mode }),
      onResult: (result) => {
        if (result.ok) this.lastResult = result;
        this.emit({ type: "result", result });
        void this.refreshIndex();
      },
      onFailure: (error) => this.emit({ type: "failure", error })
    });
    void this.refreshIndex();
  }

  request(mode: BuildMode): void {
    this.compiler.request(mode);
  }

  on(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markChanged(path: string, compile = true): void {
    if (!this.usesPath(path)) return;
    void this.refreshIndex();
    if (compile) this.request("fast");
  }

  usesPath(path: string): boolean {
    const absolute = resolve(path);
    const snapshot = this.index.current;
    return absolute === resolve(this.root)
      || this.compiler.dependencies.has(absolute)
      || snapshot.files.includes(absolute)
      || snapshot.bibFiles.includes(absolute)
      || absolute.startsWith(resolve(dirname(this.root)) + sep);
  }

  combinedDiagnostics(file?: string): Diagnostic[] {
    const compiler = this.lastResult?.diagnostics ?? [];
    if (!file) return [...compiler, ...[...this.texlabDiagnostics.values()].flat()];
    return [
      ...compiler.filter((item) => !item.file || resolve(item.file) === resolve(file)),
      ...(this.texlabDiagnostics.get(resolve(file)) ?? [])
    ];
  }

  resetTexlab(): void {
    void this.texlab.reset();
    this.texlabDiagnostics.clear();
  }

  dispose(): void {
    this.index.invalidate();
    this.compiler.dispose();
    void this.texlab.dispose();
    this.listeners.clear();
  }

  private async refreshIndex(): Promise<void> {
    try {
      const snapshot = await this.index.refresh();
      this.emit({ type: "index", snapshot });
    } catch (error) {
      this.emit({ type: "failure", error: error instanceof Error ? error : new Error(String(error)) });
    }
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

  notifyChanged(path: string, compile = true): void {
    for (const entry of this.entries.values()) {
      entry.session.markChanged(path, compile);
    }
  }

  resetTexlab(): void {
    for (const entry of this.entries.values()) entry.session.resetTexlab();
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.session.dispose();
    this.entries.clear();
  }
}
