import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FragmentOutput, LatextifierSettings } from "../types";
import { parseLatexLog } from "../core/log";
import { runProcess, texEnvironment, toolPath, ToolNotFoundError } from "../core/process";
import { stripFragmentDirective } from "./classifier";

const MAX_CACHE_ENTRIES = 96;

export class FragmentCompiler {
  private readonly cache = new Map<string, Promise<FragmentOutput>>();

  constructor(private readonly settings: () => LatextifierSettings) {}

  compile(source: string): Promise<FragmentOutput> {
    const settings = this.settings();
    const clean = stripFragmentDirective(source);
    const key = createHash("sha256")
      .update(settings.fragmentEngine)
      .update("\0")
      .update(settings.fragmentPreamble)
      .update("\0")
      .update(String(settings.allowShellEscape))
      .update("\0")
      .update(clean)
      .digest("hex");

    const existing = this.cache.get(key);
    if (existing) return existing;

    const work = this.compileUncached(clean, key).catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, work);
    this.trimCache();
    return work;
  }

  clear(): void {
    this.cache.clear();
  }

  private async compileUncached(source: string, key: string): Promise<FragmentOutput> {
    const settings = this.settings();
    const directory = join(tmpdir(), "latextifier", "fragments", key.slice(0, 24));
    await fs.mkdir(directory, { recursive: true });

    const texPath = join(directory, "source.tex");
    const pdfPath = join(directory, "fragment.pdf");
    const logPath = join(directory, "fragment.log");
    const svgPath = join(directory, "fragment.svg");
    await fs.writeFile(texPath, wrapFragment(source, settings.fragmentPreamble), "utf8");

    const args = [
      "-interaction=nonstopmode",
      "-file-line-error",
      "-halt-on-error",
      "-jobname=fragment",
      "-output-directory=" + directory
    ];
    if (settings.allowShellEscape) args.push("-shell-escape");
    args.push("source.tex");

    const run = await runProcess(
      toolPath(settings.texBinDir, settings.fragmentEngine),
      args,
      {
        cwd: directory,
        env: texEnvironment(settings.texBinDir),
        timeoutMs: 45000
      }
    );

    let rawLog = run.stdout + "\n" + run.stderr;
    try {
      rawLog += "\n" + await fs.readFile(logPath, "utf8");
    } catch {
      // stdout/stderr still provide a useful error.
    }
    const diagnostics = parseLatexLog(rawLog, directory);
    if (run.code !== 0) {
      const message = diagnostics.find((item) => item.severity === "error")?.message
        ?? "LaTeX fragment compilation failed.";
      throw new Error(message);
    }

    try {
      const svgRun = await runProcess(
        toolPath(settings.texBinDir, "dvisvgm", settings.dvisvgmPath),
        ["--pdf", "--page=1", "--bbox=min", "--exact", "--no-fonts", "-o", svgPath, pdfPath],
        {
          cwd: directory,
          env: texEnvironment(settings.texBinDir),
          timeoutMs: 30000
        }
      );
      if (svgRun.code === 0) {
        const svg = sanitizeSvg(await fs.readFile(svgPath, "utf8"));
        if (svg) return { kind: "svg", svg, diagnostics };
      }
    } catch (error) {
      if (!(error instanceof ToolNotFoundError)) {
        // SVG is an optimization. Fall through to the PDF path on converter failures.
      }
    }

    const pdfData = new Uint8Array(await fs.readFile(pdfPath));
    return { kind: "pdf", pdfData, diagnostics };
  }

  private trimCache(): void {
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}

export function wrapFragment(source: string, extraPreamble: string): string {
  if (/\\documentclass\b/.test(source)) return source;

  const auto: string[] = [
    "\\usepackage{amsmath,amssymb}",
    "\\usepackage{xcolor}"
  ];
  if (/\\begin\{tikzpicture\}|\\tikz\b/.test(source)) auto.push("\\usepackage{tikz}");
  if (/\\(?:toprule|midrule|bottomrule)\b/.test(source)) auto.push("\\usepackage{booktabs}");
  if (/\\includegraphics\b/.test(source)) auto.push("\\usepackage{graphicx}");

  return [
    "\\documentclass[preview,border=2pt]{standalone}",
    ...auto,
    extraPreamble.trim(),
    "\\begin{document}",
    source,
    "\\end{document}",
    ""
  ].filter(Boolean).join("\n");
}

export function sanitizeSvg(svg: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) return "";

  for (const blocked of Array.from(doc.querySelectorAll("script, foreignObject, iframe, object, embed"))) {
    blocked.remove();
  }
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name.endsWith(":href")) && /^(?:javascript:|https?:|file:|data:text\/html)/.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
}
