import type { FragmentMode } from "../types";

const DIRECTIVE_RE = /^\s*%\s*latextifier:\s*(auto|math|tex)\s*$/im;

export function requestedFragmentMode(source: string): FragmentMode {
  const match = DIRECTIVE_RE.exec(source);
  return (match?.[1] as FragmentMode | undefined) ?? "auto";
}

export function stripFragmentDirective(source: string): string {
  return source.replace(DIRECTIVE_RE, "").replace(/^\s*\n/, "");
}

export function classifyFragment(source: string): Exclude<FragmentMode, "auto"> {
  const requested = requestedFragmentMode(source);
  if (requested !== "auto") return requested;

  const body = stripFragmentDirective(source);
  const fullTexSignals = [
    /\\documentclass\b/,
    /\\usepackage\b/,
    /\\begin\{(?:tikzpicture|tabular\*?|figure\*?|minipage|picture|pgfpicture)\}/,
    /\\includegraphics\b/,
    /\\newcommand\b/,
    /\\definecolor\b/,
    /\\tikz\b/,
    /\\begin\{document\}/
  ];
  return fullTexSignals.some((pattern) => pattern.test(body)) ? "tex" : "math";
}
