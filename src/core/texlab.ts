import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Diagnostic, LatextifierSettings } from "../types";
import { texEnvironment, toolPath } from "./process";

export interface TexlabCompletion {
  label: string;
  detail?: string;
  insertText?: string;
  sortText?: string;
}

export interface TexlabHover {
  markdown: string;
}

export interface TexlabCallbacks {
  onDiagnostics(file: string, diagnostics: Diagnostic[]): void;
  onStatus(status: "starting" | "ready" | "unavailable" | "stopped"): void;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: number;
}

interface LspPosition {
  line: number;
  character: number;
}

export class TexlabClient {
  private process: ChildProcess | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly versions = new Map<string, number>();
  private startPromise: Promise<boolean> | null = null;
  private ready = false;
  private disposed = false;

  constructor(
    private readonly root: string,
    private readonly settings: () => LatextifierSettings,
    private readonly callbacks: TexlabCallbacks
  ) {}

  async ensureStarted(): Promise<boolean> {
    if (this.ready) return true;
    if (this.disposed || !this.settings().enableTexlab) return false;
    if (this.startPromise) return await this.startPromise;
    this.startPromise = this.start();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async open(file: string, text: string): Promise<void> {
    if (!(await this.ensureStarted())) return;
    const uri = pathToFileURL(resolve(file)).href;
    const version = 1;
    this.versions.set(uri, version);
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "latex",
        version,
        text
      }
    });
  }

  async change(file: string, text: string): Promise<void> {
    if (!(await this.ensureStarted())) return;
    const uri = pathToFileURL(resolve(file)).href;
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    });
  }

  close(file: string): void {
    if (!this.ready) return;
    const uri = pathToFileURL(resolve(file)).href;
    this.versions.delete(uri);
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  async completion(file: string, line: number, character: number): Promise<TexlabCompletion[]> {
    if (!(await this.ensureStarted())) return [];
    const result = await this.request("textDocument/completion", {
      textDocument: { uri: pathToFileURL(resolve(file)).href },
      position: toLspPosition(line, character),
      context: { triggerKind: 1 }
    }, 4500);

    const items = normalizeCompletionItems(result);
    return items.slice(0, 250).map((item) => ({
      label: stringField(item, "label") ?? "",
      detail: stringField(item, "detail"),
      insertText: stringField(item, "insertText")
        ?? stringField(recordField(item, "textEdit"), "newText"),
      sortText: stringField(item, "sortText")
    })).filter((item) => item.label);
  }

  async hover(file: string, line: number, character: number): Promise<TexlabHover | null> {
    if (!(await this.ensureStarted())) return null;
    const result = await this.request("textDocument/hover", {
      textDocument: { uri: pathToFileURL(resolve(file)).href },
      position: toLspPosition(line, character)
    }, 4000);
    const record = asRecord(result);
    const markdown = hoverContents(record?.contents);
    return markdown ? { markdown } : null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ready) {
      try {
        await this.request("shutdown", null, 1500);
      } catch {
        // Best-effort graceful shutdown.
      }
      this.notify("exit", null);
    }
    this.ready = false;
    this.rejectAll(new Error("TexLab stopped."));
    this.process?.kill();
    this.process = null;
    this.callbacks.onStatus("stopped");
  }

  private async start(): Promise<boolean> {
    this.callbacks.onStatus("starting");
    const settings = this.settings();
    const command = toolPath(settings.texBinDir, "texlab", settings.texlabPath);

    let child: ChildProcess;
    try {
      child = spawn(command, [], {
        cwd: dirname(resolve(this.root)),
        env: texEnvironment(settings.texBinDir),
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      this.callbacks.onStatus("unavailable");
      return false;
    }

    this.process = child;
    child.stdout?.on("data", (chunk: Buffer) => this.consume(Buffer.from(chunk)));
    child.stderr?.on("data", () => {
      // TexLab may write informational logging to stderr. Keep UI noise low.
    });
    child.on("error", () => {
      this.ready = false;
      this.callbacks.onStatus("unavailable");
      this.rejectAll(new Error("TexLab process failed."));
    });
    child.on("exit", () => {
      this.ready = false;
      this.process = null;
      if (!this.disposed) this.callbacks.onStatus("unavailable");
      this.rejectAll(new Error("TexLab exited."));
    });

    try {
      await this.request("initialize", {
        processId: process.pid,
        clientInfo: { name: "Latextifier", version: "0.2.0" },
        rootUri: pathToFileURL(dirname(resolve(this.root))).href,
        workspaceFolders: [{
          uri: pathToFileURL(dirname(resolve(this.root))).href,
          name: "Latextifier project"
        }],
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            completion: {
              dynamicRegistration: false,
              completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"] }
            },
            hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: { relatedInformation: true }
          }
        }
      }, 7000);
      this.ready = true;
      this.notify("initialized", {});
      this.notify("workspace/didChangeConfiguration", {
        settings: {
          texlab: {
            build: { onSave: false },
            diagnostics: { ignoredPatterns: [] }
          }
        }
      });
      this.callbacks.onStatus("ready");
      return true;
    } catch {
      child.kill();
      this.process = null;
      this.callbacks.onStatus("unavailable");
      return false;
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    this.write(message);
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error("TexLab request timed out: " + method));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer
      });
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: JsonRpcMessage): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable) return;
    const body = JSON.stringify(message);
    const payload = "Content-Length: " + String(Buffer.byteLength(body, "utf8")) + "\r\n\r\n" + body;
    stdin.write(payload);
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.handle(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // Ignore malformed server messages rather than destabilizing the editor.
      }
    }
  }

  private handle(message: JsonRpcMessage): void {
    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      window.clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? "TexLab request failed."));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const params = asRecord(message.params);
      const uri = typeof params?.uri === "string" ? params.uri : null;
      const items = Array.isArray(params?.diagnostics) ? params.diagnostics : [];
      if (!uri || !uri.startsWith("file:")) return;
      let file: string;
      try {
        file = fileURLToPath(uri);
      } catch {
        return;
      }
      this.callbacks.onDiagnostics(file, items.map(toDiagnostic).filter((item): item is Diagnostic => item !== null));
      return;
    }

    if (message.method === "workspace/configuration" && typeof message.id === "number") {
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        result: [{ build: { onSave: false } }]
      });
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function toLspPosition(line: number, character: number): LspPosition {
  return {
    line: Math.max(0, line - 1),
    character: Math.max(0, character)
  };
}

function normalizeCompletionItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
  const record = asRecord(value);
  const items = record?.items;
  return Array.isArray(items) ? items.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : [];
}

function toDiagnostic(value: unknown): Diagnostic | null {
  const record = asRecord(value);
  if (!record) return null;
  const range = asRecord(record.range);
  const start = asRecord(range?.start);
  const line = typeof start?.line === "number" ? start.line + 1 : undefined;
  const column = typeof start?.character === "number" ? start.character : undefined;
  const severity = typeof record.severity === "number"
    ? record.severity === 1 ? "error" : record.severity === 2 ? "warning" : "info"
    : "info";
  const message = typeof record.message === "string" ? record.message : "TexLab diagnostic";
  return { severity, message, line, column };
}

function hoverContents(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(hoverContents).filter(Boolean).join("\n\n");
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.value === "string") return record.value;
  return "";
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asRecord(record[key]);
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
