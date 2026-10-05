import { finishRenderMath, loadPdfJs, renderMath } from "obsidian";
import type { FragmentOutput } from "../types";
import { classifyFragment, stripFragmentDirective } from "./classifier";
import { FragmentCompiler } from "./fragment-compiler";

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    viewport: PdfViewport;
  }): { promise: Promise<void> };
}

interface PdfDocument {
  getPage(page: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfJs {
  getDocument(options: {
    data: Uint8Array;
    isEvalSupported: boolean;
    cMapUrl: string;
    cMapPacked: boolean;
    standardFontDataUrl: string;
    wasmUrl: string;
    iccUrl: string;
  }): { promise: Promise<PdfDocument> };
}

export class MarkdownLatexRenderer {
  constructor(private readonly compiler: FragmentCompiler) {}

  async render(source: string, container: HTMLElement): Promise<void> {
    container.empty();
    container.addClass("latextifier-markdown-block");

    const mode = classifyFragment(source);
    const clean = stripFragmentDirective(source).trim();

    if (mode === "math") {
      try {
        container.appendChild(renderMath(clean, true));
        await finishRenderMath();
      } catch (error) {
        renderError(container, error);
      }
      return;
    }

    const loading = container.createDiv({ cls: "latextifier-fragment-loading", text: "Rendering LaTeX…" });
    try {
      const output = await this.compiler.compile(source);
      if (!container.isConnected) return;
      loading.remove();
      await renderCompiled(output, container);
    } catch (error) {
      loading.remove();
      renderError(container, error);
    }
  }
}

async function renderCompiled(output: FragmentOutput, container: HTMLElement): Promise<void> {
  if (output.kind === "svg" && output.svg) {
    const holder = container.createDiv({ cls: "latextifier-fragment-svg" });
    const parsed = new DOMParser().parseFromString(output.svg, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Generated SVG could not be parsed safely.");
    const svg = parsed.documentElement;
    svg.setAttribute("role", "img");
    holder.appendChild(container.ownerDocument.importNode(svg, true));
    return;
  }

  if (!output.pdfData) throw new Error("LaTeX produced no renderable output.");
  const pdfjs = await loadPdfJs() as PdfJs;
  const doc = await pdfjs.getDocument({
    data: output.pdfData.slice(),
    isEvalSupported: false,
    cMapUrl: "/lib/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
    wasmUrl: "/lib/pdfjs/wasm/",
    iccUrl: "/lib/pdfjs/iccs/"
  }).promise;

  try {
    const page = await doc.getPage(1);
    const cssScale = 4 / 3;
    const cssViewport = page.getViewport({ scale: cssScale });
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: cssScale * dpr });
    const canvas = container.createEl("canvas", { cls: "latextifier-fragment-canvas" });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = String(cssViewport.width) + "px";
    canvas.style.height = String(cssViewport.height) + "px";
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    await page.render({ canvasContext: context, canvas, viewport }).promise;
  } finally {
    await doc.destroy();
  }
}

function renderError(container: HTMLElement, error: unknown): void {
  container.empty();
  container.createDiv({ cls: "latextifier-error-title", text: "LaTeX render failed" });
  container.createEl("pre", {
    cls: "latextifier-error",
    text: error instanceof Error ? error.message : String(error)
  });
}
