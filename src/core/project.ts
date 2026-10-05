import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Engine } from "../types";

export interface TexDirectives {
  root?: string;
  program?: Engine;
}

const ROOT_RE = /^\s*%\s*!TEX\s+root\s*=\s*(.+?)\s*$/im;
const PROGRAM_RE = /^\s*%\s*!TEX\s+program\s*=\s*(pdf|lua|xe)?latex\s*$/im;

export function parseTexDirectives(text: string): TexDirectives {
  const root = ROOT_RE.exec(text)?.[1]?.trim();
  const programMatch = PROGRAM_RE.exec(text);
  let program: Engine | undefined;
  const raw = programMatch?.[1];
  if (raw === "xe") program = "xelatex";
  else if (raw === "lua") program = "lualatex";
  else if (programMatch) program = "pdflatex";
  return { root, program };
}

export function detectEngine(text: string, fallback: Engine): Engine {
  const directive = parseTexDirectives(text).program;
  if (directive) return directive;
  if (/\\usepackage(?:\[[^\]]*\])?\{fontspec\}|\\setmainfont\b/.test(text)) return "xelatex";
  if (/\\directlua\b|\\usepackage(?:\[[^\]]*\])?\{luacode\}/.test(text)) return "lualatex";
  return fallback;
}

export function containsDocumentClass(text: string): boolean {
  return /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(text);
}

export async function resolveProjectRoot(sourcePath: string, vaultRoot: string): Promise<string> {
  const source = resolve(sourcePath);
  const vault = resolve(vaultRoot);
  const sourceText = await readText(source);

  const directive = parseTexDirectives(sourceText).root;
  if (directive) {
    const candidate = resolve(dirname(source), directive);
    if (await exists(candidate)) return candidate;
  }
  if (containsDocumentClass(sourceText)) return source;

  let directory = dirname(source);
  while (inside(directory, vault)) {
    const candidates = await texFiles(directory);
    let best: { path: string; score: number } | null = null;
    for (const candidate of candidates) {
      if (candidate === source) continue;
      const text = await readHead(candidate, 192 * 1024);
      if (!containsDocumentClass(text)) continue;
      const score = inclusionScore(text, candidate, source);
      if (!best || score > best.score) best = { path: candidate, score };
    }
    if (best && best.score > 0) return best.path;
    if (best) return best.path;
    if (directory === vault) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return source;
}

function inclusionScore(rootText: string, rootPath: string, sourcePath: string): number {
  const rel = relative(dirname(rootPath), sourcePath).split(sep).join("/");
  const withoutExt = rel.replace(/\.tex$/i, "");
  const stem = basename(sourcePath, ".tex");
  if (rootText.includes("\\input{" + withoutExt + "}") || rootText.includes("\\include{" + withoutExt + "}")) return 4;
  if (rootText.includes("\\input{" + stem + "}") || rootText.includes("\\include{" + stem + "}")) return 3;
  return 1;
}

async function texFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".tex"))
      .slice(0, 200)
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

async function readText(path: string): Promise<string> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readHead(path: string, maxBytes: number): Promise<string> {
  try {
    const handle = await fs.open(path, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}

function inside(path: string, root: string): boolean {
  if (path === root) return true;
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel);
}
