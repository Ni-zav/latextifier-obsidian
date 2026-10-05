import { dirname, isAbsolute, resolve } from "node:path";
import type { PdfBox, SourceLocation } from "../types";
import { runProcess, texEnvironment, toolPath } from "./process";

export function parseSyncTexView(raw: string): PdfBox | null {
  const fields = firstRecord(raw);
  const page = Number(fields.get("Page"));
  const h = Number(fields.get("h"));
  const v = Number(fields.get("v"));
  const width = Number(fields.get("W"));
  const height = Number(fields.get("H"));
  if (![page, h, v].every(Number.isFinite)) return null;
  return {
    page,
    x: h,
    y: v - (Number.isFinite(height) ? height : 0),
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0
  };
}

export function parseSyncTexEdit(raw: string, rootDir: string): SourceLocation | null {
  const fields = firstRecord(raw);
  const input = fields.get("Input");
  const line = Number(fields.get("Line"));
  const column = Number(fields.get("Column"));
  if (!input || !Number.isFinite(line) || line < 1) return null;
  return {
    file: isAbsolute(input) ? resolve(input) : resolve(rootDir, input),
    line,
    column: Number.isFinite(column) && column >= 0 ? column : undefined
  };
}

export async function forwardSearch(
  binDir: string,
  explicitSynctex: string,
  pdfPath: string,
  sourceFile: string,
  line: number,
  column: number
): Promise<PdfBox | null> {
  const result = await runProcess(
    toolPath(binDir, "synctex", explicitSynctex),
    ["view", "-i", String(line) + ":" + String(Math.max(column, 0)) + ":" + sourceFile, "-o", pdfPath],
    { cwd: dirname(pdfPath), env: texEnvironment(binDir), timeoutMs: 5000 }
  );
  return result.code === 0 ? parseSyncTexView(result.stdout) : null;
}

export async function inverseSearch(
  binDir: string,
  explicitSynctex: string,
  pdfPath: string,
  page: number,
  x: number,
  y: number,
  rootDir: string
): Promise<SourceLocation | null> {
  const result = await runProcess(
    toolPath(binDir, "synctex", explicitSynctex),
    ["edit", "-o", String(page) + ":" + x.toFixed(2) + ":" + y.toFixed(2) + ":" + pdfPath],
    { cwd: dirname(pdfPath), env: texEnvironment(binDir), timeoutMs: 5000 }
  );
  return result.code === 0 ? parseSyncTexEdit(result.stdout, rootDir) : null;
}

function firstRecord(raw: string): Map<string, string> {
  const record = raw.split(/^Output:/m).slice(1)[0] ?? raw;
  const fields = new Map<string, string>();
  for (const line of record.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon);
    if (!fields.has(key)) fields.set(key, line.slice(colon + 1).trim());
  }
  return fields;
}
