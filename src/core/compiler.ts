import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { BuildMode, BuildResult, LatextifierSettings } from "../types";
import { logRequestsRerun, parseLatexLog } from "./log";
import { detectEngine } from "./project";
import { runProcess, texEnvironment, toolPath, ToolNotFoundError } from "./process";

export interface CompilerListener {
  onStart(mode: BuildMode): void;
  onResult(result: BuildResult): void;
  onFailure(error: Error): void;
}

export class ProjectCompiler {
  private pending: BuildMode | null = null;
  private busy = false;
  private disposed = false;
  private controller = new AbortController();
  readonly outputDir: string;
  readonly jobName: string;
  dependencies = new Set<string>();

  constructor(
    readonly root: string,
    private readonly settings: () => LatextifierSettings,
    private readonly listener: CompilerListener
  ) {
    this.jobName = basename(root, extname(root));
    const key = createHash("sha1").update(resolve(root)).digest("hex").slice(0, 20);
    this.outputDir = join(tmpdir(), "latextifier", "projects", key);
  }

  get compiling(): boolean {
    return this.busy;
  }

  get pdfPath(): string {
    return join(this.outputDir, this.jobName + ".pdf");
  }

  request(mode: BuildMode): void {
    if (this.disposed) return;
    this.pending = this.pending === "full" || mode === "full" ? "full" : "fast";
    if (!this.busy) void this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.controller.abort();
  }

  private async drain(): Promise<void> {
    this.busy = true;
    try {
      while (this.pending && !this.disposed) {
        const mode = this.pending;
        this.pending = null;
        this.listener.onStart(mode);
        try {
          const result = mode === "full" ? await this.buildFull() : await this.buildFast();
          if (!this.disposed) this.listener.onResult(result);
        } catch (error) {
          if (!this.disposed) this.listener.onFailure(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async buildFast(): Promise<BuildResult> {
    const started = Date.now();
    await fs.mkdir(this.outputDir, { recursive: true });
    const rootText = await fs.readFile(this.root, "utf8");
    const settings = this.settings();
    const engine = detectEngine(rootText, settings.defaultEngine);

    let run = await this.runEngine(engine);
    let combined = run.stdout + "\n" + run.stderr + "\n" + await this.readLog();
    if (run.code === 0 && logRequestsRerun(combined) && !this.pending && !this.disposed) {
      run = await this.runEngine(engine);
      combined = run.stdout + "\n" + run.stderr + "\n" + await this.readLog();
    }

    return await this.finish("fast", engine, run.code, combined, started);
  }

  private async buildFull(): Promise<BuildResult> {
    const started = Date.now();
    await fs.mkdir(this.outputDir, { recursive: true });
    const rootText = await fs.readFile(this.root, "utf8");
    const settings = this.settings();
    const engine = detectEngine(rootText, settings.defaultEngine);
    const latexmk = toolPath(settings.texBinDir, "latexmk", settings.latexmkPath);
    const flag = engine === "xelatex" ? "-pdfxe" : engine === "lualatex" ? "-pdflua" : "-pdf";
    const args = [
      flag,
      "-interaction=nonstopmode",
      "-file-line-error",
      "-synctex=1",
      "-recorder",
      "-outdir=" + this.outputDir,
      basename(this.root)
    ];

    try {
      const run = await runProcess(latexmk, args, {
        cwd: dirname(this.root),
        env: texEnvironment(settings.texBinDir),
        timeoutMs: 120000,
        signal: this.controller.signal
      });
      const combined = run.stdout + "\n" + run.stderr + "\n" + await this.readLog();
      return await this.finish("full", engine, run.code, combined, started);
    } catch (error) {
      if (!(error instanceof ToolNotFoundError)) throw error;
      const first = await this.runEngine(engine);
      const second = first.code === 0 ? await this.runEngine(engine) : first;
      const combined = second.stdout + "\n" + second.stderr + "\n" + await this.readLog()
        + "\nLatextifier: latexmk was unavailable; full build fell back to direct TeX passes.";
      return await this.finish("full", engine, second.code, combined, started);
    }
  }

  private async runEngine(engine: "pdflatex" | "xelatex" | "lualatex") {
    const settings = this.settings();
    const args = [
      "-interaction=nonstopmode",
      "-file-line-error",
      "-halt-on-error",
      "-synctex=1",
      "-recorder",
      "-output-directory=" + this.outputDir
    ];
    if (settings.allowShellEscape) args.push("-shell-escape");
    args.push(basename(this.root));

    return await runProcess(toolPath(settings.texBinDir, engine), args, {
      cwd: dirname(this.root),
      env: texEnvironment(settings.texBinDir),
      timeoutMs: 90000,
      signal: this.controller.signal
    });
  }

  private async finish(
    mode: BuildMode,
    engine: "pdflatex" | "xelatex" | "lualatex",
    exitCode: number,
    rawLog: string,
    started: number
  ): Promise<BuildResult> {
    const diagnostics = parseLatexLog(rawLog, dirname(this.root));
    const deps = await this.readDependencies();
    this.dependencies = deps;
    const pdfData = exitCode === 0 ? await this.readPdf() : null;
    const ok = exitCode === 0 && pdfData !== null;

    if (!ok && diagnostics.length === 0) {
      diagnostics.push({
        severity: "error",
        message: "TeX exited with code " + String(exitCode) + ". Open the build log for details."
      });
    }

    return {
      ok,
      mode,
      engine,
      root: this.root,
      pdfPath: this.pdfPath,
      pdfData,
      diagnostics,
      rawLog,
      durationMs: Date.now() - started,
      dependencies: deps
    };
  }

  private async readPdf(): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.pdfPath));
    } catch {
      return null;
    }
  }

  private async readLog(): Promise<string> {
    try {
      return await fs.readFile(join(this.outputDir, this.jobName + ".log"), "utf8");
    } catch {
      return "";
    }
  }

  private async readDependencies(): Promise<Set<string>> {
    const found = new Set<string>([resolve(this.root)]);
    try {
      const fls = await fs.readFile(join(this.outputDir, this.jobName + ".fls"), "utf8");
      for (const line of fls.split(/\r?\n/)) {
        if (!line.startsWith("INPUT ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        found.add(resolve(dirname(this.root), raw));
      }
    } catch {
      // Recorder files are optional; the root itself is still tracked.
    }
    return found;
  }
}
