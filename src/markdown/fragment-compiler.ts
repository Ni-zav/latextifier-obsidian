import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import type { FragmentOutput, LatextifierSettings } from "../types";
import { parseLatexLog } from "../core/log";
import { runProcess, texEnvironment, toolPath, ToolNotFoundError } from "../core/process";
import { stripFragmentDirective } from "./classifier";

const MAX_CACHE_ENTRIES = 96;

export interface FragmentCompileOptions {
  extraPreamble?: string;
  contextDir?: string;
}

export class FragmentCompiler {
  private readonly cache = new Map<string, Promise<FragmentOutput>>();

  constructor(private readonly settings: () => LatextifierSettings) {}

  compile(source: string, options: FragmentCompileOptions = {}): Promise<FragmentOutput> {
    const settings = this.settings();
    const clean = stripFragmentDirective(source);
    const combinedPreamble = [settings.fragmentPreamble, options.extraPreamble ?? ""].filter(Boolean).join("\n");
    const key = createHash("sha256")
      .update(settings.fragmentEngine)
      .update("\0")
      .update(combinedPreamble)
      .update("\0")
      .update(options.contextDir ?? "")
      .update("\0")
      .update(String(settings.allowShellEscape))
      .update("\0")
      .update(clean)
      .digest("hex");

    const existing = this.cache.get(key);
    if (existing) return existing;

    const work = this.compileUncached(clean, key, {
      ...options,
      extraPreamble: combinedPreamble
    }).catch((error) => {
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

  private async compileUncached(
    source: string,
    key: string,
    options: FragmentCompileOptions
  ): Promise<FragmentOutput> {
    const settings = this.settings();
    const directory = join(tmpdir(), "latextifier", "fragments", key.slice(0, 24));
    await fs.mkdir(directory, { recursive: true });

    const texPath = join(directory, "source.tex");
    const pdfPath = join(directory, "fragment.pdf");
    const logPath = join(directory, "fragment.log");
    const svgPath = join(directory, "fragment.svg");
    await fs.writeFile(texPath, wrapFragment(source, options.extraPreamble ?? ""), "utf8");

    const args = [
      "-interaction=nonstopmode",
      "-file-line-error",
      "-halt-on-error",
      "-jobname=fragment",
      "-output-directory=" + directory
    ];
    if (settings.allowShellEscape) args.push("-shell-escape");
    args.push(options.contextDir ? texPath : "source.tex");

    let run = await runProcess(
      toolPath(settings.texBinDir, settings.fragmentEngine),
      args,
      {
        cwd: options.contextDir ?? directory,
        env: fragmentEnvironment(settings.texBinDir, options.contextDir),
        timeoutMs: 45000
      }
    );

    let rawLog = await fragmentLog(run.stdout, run.stderr, logPath);
    if (
      run.code !== 0
      && !/\\documentclass\b/.test(source)
      && /standalone\.cls[\s\S]*(?:not found|cannot find)|File .*standalone\.cls.*not found/i.test(rawLog)
    ) {
      await fs.writeFile(texPath, wrapFragmentFallback(source, options.extraPreamble ?? ""), "utf8");
      run = await runProcess(
        toolPath(settings.texBinDir, settings.fragmentEngine),
        args,
        {
          cwd: directory,
          env: fragmentEnvironment(settings.texBinDir, options.contextDir),
          timeoutMs: 45000
        }
      );
      rawLog = await fragmentLog(run.stdout, run.stderr, logPath);
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
          env: fragmentEnvironment(settings.texBinDir, options.contextDir),
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
      const oldest = this.cache.keys().next().value;
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

export function wrapFragmentFallback(source: string, extraPreamble: string): string {
  if (/\\documentclass\b/.test(source)) return source;
  const auto: string[] = [
    "\\usepackage{amsmath,amssymb}",
    "\\usepackage{xcolor}"
  ];
  if (/\\begin\{tikzpicture\}|\\tikz\b/.test(source)) auto.push("\\usepackage{tikz}");
  if (/\\(?:toprule|midrule|bottomrule)\b/.test(source)) auto.push("\\usepackage{booktabs}");
  if (/\\includegraphics\b/.test(source)) auto.push("\\usepackage{graphicx}");

  return [
    "\\documentclass{article}",
    "\\pagestyle{empty}",
    "\\setlength{\\parindent}{0pt}",
    ...auto,
    extraPreamble.trim(),
    "\\begin{document}",
    source,
    "\\end{document}",
    ""
  ].filter(Boolean).join("\n");
}

function fragmentEnvironment(binDir: string, contextDir?: string): NodeJS.ProcessEnv {
  const env = texEnvironment(binDir);
  if (!contextDir) return env;
  const current = env.TEXINPUTS ?? "";
  env.TEXINPUTS = contextDir + delimiter + current + delimiter;
  return env;
}

async function fragmentLog(stdout: string, stderr: string, logPath: string): Promise<string> {
  let value = stdout + "\n" + stderr;
  try {
    value += "\n" + await fs.readFile(logPath, "utf8");
  } catch {
    // stdout/stderr still provide a useful error.
  }
  return value;
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
