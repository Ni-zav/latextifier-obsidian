import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { delimiter, extname, join } from "node:path";
import { platform } from "node:os";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ToolNotFoundError extends Error {
  constructor(readonly tool: string) {
    super("Required tool not found: " + tool);
    this.name = "ToolNotFoundError";
  }
}

export function toolPath(binDir: string, tool: string, explicit = ""): string {
  if (explicit.trim()) return explicit.trim();
  if (!binDir.trim()) return tool;
  const suffix = platform() === "win32" && !extname(tool) ? ".exe" : "";
  return join(binDir.trim(), tool + suffix);
}

export function texEnvironment(binDir: string): NodeJS.ProcessEnv {
  if (!binDir.trim()) return { ...process.env };
  const current = process.env.PATH ?? process.env.Path ?? "";
  return { ...process.env, PATH: binDir.trim() + delimiter + current };
}

export async function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions
): Promise<ProcessResult> {
  const started = Date.now();

  return await new Promise<ProcessResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishResolve = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, stdout, stderr, durationMs: Date.now() - started });
    };

    const onAbort = () => {
      child.kill();
      finishReject(new Error("Process aborted."));
    };

    const timeout = setTimeout(() => {
      child.kill();
      finishReject(new Error("Process timed out after " + String(options.timeoutMs ?? 60000) + " ms."));
    }, options.timeoutMs ?? 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") finishReject(new ToolNotFoundError(command));
      else finishReject(error);
    });
    child.on("close", (code) => finishResolve(code ?? 1));

    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}
