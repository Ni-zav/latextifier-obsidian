import { promises as fs } from "node:fs";
import { dirname, extname, resolve } from "node:path";

export type OutlineKind =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph"
  | "subparagraph";

export interface ProjectLocation {
  file: string;
  line: number;
  column: number;
}

export interface ProjectOutlineItem extends ProjectLocation {
  kind: OutlineKind;
  title: string;
  level: number;
}

export interface ProjectTodo extends ProjectLocation {
  text: string;
}

export interface ProjectCitation extends ProjectLocation {
  key: string;
  kind?: string;
  title?: string;
  author?: string;
  year?: string;
}

export interface ProjectLabel extends ProjectLocation {
  key: string;
}

export interface ProjectCommand extends ProjectLocation {
  name: string;
  arguments: number;
}

export interface ProjectEnvironment extends ProjectLocation {
  name: string;
}

export interface ProjectSnapshot {
  root: string;
  files: string[];
  bibFiles: string[];
  packages: string[];
  labels: ProjectLabel[];
  citations: ProjectCitation[];
  commands: ProjectCommand[];
  environments: ProjectEnvironment[];
  outline: ProjectOutlineItem[];
  todos: ProjectTodo[];
  updatedAt: number;
}

const EMPTY_SNAPSHOT: ProjectSnapshot = {
  root: "",
  files: [],
  bibFiles: [],
  packages: [],
  labels: [],
  citations: [],
  commands: [],
  environments: [],
  outline: [],
  todos: [],
  updatedAt: 0
};

const OUTLINE_LEVEL: Record<OutlineKind, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6
};

const INCLUDE_RE = /\\(?:input|include|subfile)\s*\{([^}]+)\}/g;
const BIB_RESOURCE_RE = /\\addbibresource(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
const BIBLIOGRAPHY_RE = /\\bibliography\s*\{([^}]+)\}/g;
const PACKAGE_RE = /\\usepackage(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
const LABEL_RE = /\\label\s*\{([^}]+)\}/g;
const BIBITEM_RE = /\\bibitem(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
const NEW_COMMAND_RE = /\\(?:re)?newcommand\s*\{?\\([A-Za-z@]+)\}?(?:\[(\d+)\])?/g;
const NEW_ENV_RE = /\\(?:re)?newenvironment\s*\{([^}]+)\}/g;
const OUTLINE_RE = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
const TODO_RE = /(?:%+\s*(?:TODO|FIXME|XXX)\b[:\s-]*(.*)$|\\todo(?:\[[^\]]*\])?\s*\{([^}]*)\})/gim;
const BIB_ENTRY_RE = /@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|\s*$)/g;
const BIB_FIELD_RE = /^\s*([A-Za-z]+)\s*=\s*(?:\{([^}]*)\}|"([^"]*)"|([^,\n]+))\s*,?/gim;

export class ProjectIndex {
  private snapshot: ProjectSnapshot = EMPTY_SNAPSHOT;
  private generation = 0;

  constructor(readonly root: string) {}

  get current(): ProjectSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<ProjectSnapshot> {
    const generation = ++this.generation;
    const builder = new IndexBuilder(this.root);
    const next = await builder.build();
    if (generation === this.generation) this.snapshot = next;
    return this.snapshot;
  }

  invalidate(): void {
    this.generation += 1;
  }
}

class IndexBuilder {
  private readonly files = new Set<string>();
  private readonly bibFiles = new Set<string>();
  private readonly packages = new Set<string>();
  private readonly labels = new Map<string, ProjectLabel>();
  private readonly citations = new Map<string, ProjectCitation>();
  private readonly commands = new Map<string, ProjectCommand>();
  private readonly environments = new Map<string, ProjectEnvironment>();
  private readonly outline: ProjectOutlineItem[] = [];
  private readonly todos: ProjectTodo[] = [];

  constructor(private readonly root: string) {}

  async build(): Promise<ProjectSnapshot> {
    await this.visitTex(resolve(this.root), 0);
    for (const file of [...this.bibFiles]) await this.visitBib(file);

    return {
      root: resolve(this.root),
      files: [...this.files].sort(),
      bibFiles: [...this.bibFiles].sort(),
      packages: [...this.packages].sort((a, b) => a.localeCompare(b)),
      labels: [...this.labels.values()].sort((a, b) => a.key.localeCompare(b.key)),
      citations: [...this.citations.values()].sort((a, b) => a.key.localeCompare(b.key)),
      commands: [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name)),
      environments: [...this.environments.values()].sort((a, b) => a.name.localeCompare(b.name)),
      outline: this.outline.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column),
      todos: this.todos.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column),
      updatedAt: Date.now()
    };
  }

  private async visitTex(path: string, depth: number): Promise<void> {
    const file = normalizeTexPath(path);
    if (this.files.has(file) || depth > 96 || this.files.size >= 768) return;

    const text = await readUtf8(file);
    if (text === null) return;
    this.files.add(file);
    this.parseTex(file, text);

    const directory = dirname(file);
    for (const include of findAll(INCLUDE_RE, text)) {
      const raw = include[1]?.trim();
      if (!raw) continue;
      await this.visitTex(resolve(directory, ensureExtension(raw, ".tex")), depth + 1);
    }

    for (const resource of findAll(BIB_RESOURCE_RE, text)) {
      const raw = resource[1]?.trim();
      if (!raw) continue;
      this.bibFiles.add(resolve(directory, ensureExtension(raw, ".bib")));
    }

    for (const resource of findAll(BIBLIOGRAPHY_RE, text)) {
      for (const part of (resource[1] ?? "").split(",")) {
        const raw = part.trim();
        if (raw) this.bibFiles.add(resolve(directory, ensureExtension(raw, ".bib")));
      }
    }
  }

  private parseTex(file: string, text: string): void {
    for (const match of findAll(PACKAGE_RE, text)) {
      for (const name of (match[1] ?? "").split(",")) {
        const pkg = name.trim();
        if (pkg) this.packages.add(pkg);
      }
    }

    for (const match of findAll(LABEL_RE, text)) {
      const key = match[1]?.trim();
      if (!key || this.labels.has(key)) continue;
      this.labels.set(key, { key, ...locationOf(text, match.index ?? 0, file) });
    }

    for (const match of findAll(BIBITEM_RE, text)) {
      const key = match[1]?.trim();
      if (!key || this.citations.has(key)) continue;
      this.citations.set(key, { key, kind: "bibitem", ...locationOf(text, match.index ?? 0, file) });
    }

    for (const match of findAll(NEW_COMMAND_RE, text)) {
      const name = match[1]?.trim();
      if (!name || this.commands.has(name)) continue;
      this.commands.set(name, {
        name,
        arguments: Number(match[2] ?? 0),
        ...locationOf(text, match.index ?? 0, file)
      });
    }

    for (const match of findAll(NEW_ENV_RE, text)) {
      const name = match[1]?.trim();
      if (!name || this.environments.has(name)) continue;
      this.environments.set(name, { name, ...locationOf(text, match.index ?? 0, file) });
    }

    for (const match of findAll(OUTLINE_RE, text)) {
      const kind = match[1] as OutlineKind | undefined;
      const title = cleanLatexText(match[2] ?? "");
      if (!kind || !title) continue;
      this.outline.push({
        kind,
        title,
        level: OUTLINE_LEVEL[kind],
        ...locationOf(text, match.index ?? 0, file)
      });
    }

    for (const match of findAll(TODO_RE, text)) {
      const value = (match[1] ?? match[2] ?? "").trim();
      this.todos.push({
        text: value || "TODO",
        ...locationOf(text, match.index ?? 0, file)
      });
    }
  }

  private async visitBib(file: string): Promise<void> {
    const text = await readUtf8(file);
    if (text === null) return;
    this.bibFiles.add(file);

    for (const match of findAll(BIB_ENTRY_RE, text)) {
      const kind = match[1]?.trim();
      const key = match[2]?.trim();
      if (!key || this.citations.has(key)) continue;
      const fields = parseBibFields(match[3] ?? "");
      this.citations.set(key, {
        key,
        kind,
        title: fields.get("title"),
        author: fields.get("author"),
        year: fields.get("year") ?? fields.get("date"),
        ...locationOf(text, match.index ?? 0, file)
      });
    }
  }
}

export function searchProject(
  snapshot: ProjectSnapshot,
  query: string,
  limit = 100
): Array<{ file: string; line: number; text: string }> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches: Array<{ file: string; line: number; text: string }> = [];

  for (const item of snapshot.outline) {
    if (item.title.toLocaleLowerCase().includes(needle)) {
      matches.push({ file: item.file, line: item.line, text: item.title });
    }
    if (matches.length >= limit) return matches;
  }
  for (const item of snapshot.todos) {
    if (item.text.toLocaleLowerCase().includes(needle)) {
      matches.push({ file: item.file, line: item.line, text: item.text });
    }
    if (matches.length >= limit) return matches;
  }
  for (const item of snapshot.labels) {
    if (item.key.toLocaleLowerCase().includes(needle)) {
      matches.push({ file: item.file, line: item.line, text: "\\label{" + item.key + "}" });
    }
    if (matches.length >= limit) return matches;
  }
  for (const item of snapshot.citations) {
    const haystack = [item.key, item.title, item.author, item.year].filter(Boolean).join(" ").toLocaleLowerCase();
    if (haystack.includes(needle)) {
      matches.push({ file: item.file, line: item.line, text: item.title ? item.key + " — " + item.title : item.key });
    }
    if (matches.length >= limit) return matches;
  }

  return matches;
}

function parseBibFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  BIB_FIELD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BIB_FIELD_RE.exec(body)) !== null) {
    const key = match[1]?.toLocaleLowerCase();
    const value = cleanLatexText(match[2] ?? match[3] ?? match[4] ?? "");
    if (key && value && !fields.has(key)) fields.set(key, value);
  }
  return fields;
}

function findAll(regex: RegExp, text: string): RegExpExecArray[] {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const copy = new RegExp(regex.source, flags);
  return [...text.matchAll(copy)];
}

function locationOf(text: string, index: number, file: string): ProjectLocation {
  let line = 1;
  let lastBreak = -1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1;
      lastBreak = cursor;
    }
  }
  return { file, line, column: Math.max(0, index - lastBreak - 1) };
}

function ensureExtension(path: string, extension: string): string {
  return extname(path) ? path : path + extension;
}

function normalizeTexPath(path: string): string {
  return resolve(ensureExtension(path, ".tex"));
}

function cleanLatexText(value: string): string {
  return value
    .replace(/\\(?:textit|textbf|emph|texorpdfstring)\*?\s*\{([^{}]*)\}/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function readUtf8(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}
