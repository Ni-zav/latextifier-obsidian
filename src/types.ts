export type Engine = "pdflatex" | "xelatex" | "lualatex";
export type BuildMode = "fast" | "full";
export type DiagnosticSeverity = "error" | "warning" | "info";
export type FragmentMode = "auto" | "math" | "tex";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface BuildResult {
  ok: boolean;
  mode: BuildMode;
  engine: Engine;
  root: string;
  pdfPath: string;
  pdfData: Uint8Array | null;
  diagnostics: Diagnostic[];
  rawLog: string;
  durationMs: number;
  dependencies: Set<string>;
}

export interface PdfBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

export interface FragmentOutput {
  kind: "svg" | "pdf";
  svg?: string;
  pdfData?: Uint8Array;
  diagnostics: Diagnostic[];
}

export interface LatextifierSettings {
  compileDebounceMs: number;
  autoCompile: boolean;
  defaultEngine: Engine;
  fragmentEngine: Engine;
  texBinDir: string;
  latexmkPath: string;
  synctexPath: string;
  dvisvgmPath: string;
  fragmentPreamble: string;
  previewVisibleByDefault: boolean;
  allowShellEscape: boolean;
}
