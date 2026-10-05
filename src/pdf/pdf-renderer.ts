import { loadPdfJs } from "obsidian";
import type { PdfBox } from "../types";

const CSS_PER_PT = 4 / 3;
const PDFJS_ASSETS = {
  cMapUrl: "/lib/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
  wasmUrl: "/lib/pdfjs/wasm/",
  iccUrl: "/lib/pdfjs/iccs/"
};

export interface PdfPoint {
  page: number;
  x: number;
  y: number;
}

export interface PdfRendererCallbacks {
  onInversePoint?: (point: PdfPoint) => void;
  onStatus?: (page: number, pages: number, scale: number) => void;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface RenderTask {
  promise: Promise<void>;
  cancel(): void;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent?(): Promise<unknown>;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    viewport: PdfViewport;
  }): RenderTask;
}

interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
}

interface TextLayerTask {
  render(): Promise<void>;
}

interface PdfJs {
  TextLayer?: new (options: {
    textContentSource: unknown;
    container: HTMLElement;
    viewport: PdfViewport;
  }) => TextLayerTask;
  getDocument(options: {
    data: Uint8Array;
    isEvalSupported: boolean;
    cMapUrl: string;
    cMapPacked: boolean;
    standardFontDataUrl: string;
    wasmUrl: string;
    iccUrl: string;
  }): PdfLoadingTask;
}

interface PageSize {
  width: number;
  height: number;
}

interface Anchor {
  page: number;
  offset: number;
}

export class PdfRenderer {
  readonly scrollEl: HTMLDivElement;
  private readonly pagesEl: HTMLDivElement;
  private readonly observer: IntersectionObserver;
  private readonly pageSizes = new Map<number, PageSize>();
  private readonly visiblePages = new Set<number>();
  private readonly rendered = new Set<number>();
  private readonly renderTasks = new Map<number, RenderTask>();
  private doc: PdfDocument | null = null;
  private pdfjs: PdfJs | null = null;
  private generation = 0;
  private scale = 1;
  private totalPages = 0;
  private highlight: HTMLElement | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: PdfRendererCallbacks = {}
  ) {
    host.empty();
    host.addClass("latextifier-pdf-host");
    this.scrollEl = host.createDiv({ cls: "latextifier-pdf-scroll" });
    this.pagesEl = this.scrollEl.createDiv({ cls: "latextifier-pdf-pages" });

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!Number.isFinite(page)) continue;
          if (entry.isIntersecting) {
            this.visiblePages.add(page);
            void this.renderPage(page);
          } else {
            this.visiblePages.delete(page);
          }
        }
        this.trimRendered();
        this.emitStatus();
      },
      { root: this.scrollEl, rootMargin: "900px 0px" }
    );

    this.scrollEl.addEventListener("scroll", () => this.emitStatus(), { passive: true });
    this.scrollEl.addEventListener("dblclick", (event) => {
      const point = this.pointFromEvent(event);
      if (point) this.callbacks.onInversePoint?.(point);
    });
  }

  async load(data: Uint8Array): Promise<void> {
    const anchor = this.captureAnchor();
    const generation = ++this.generation;
    await this.destroyDocument();
    this.resetPages();

    const pdfjs = (await loadPdfJs()) as PdfJs;
    if (generation !== this.generation) return;
    this.pdfjs = pdfjs;

    const loading = pdfjs.getDocument({
      data: data.slice(),
      isEvalSupported: false,
      ...PDFJS_ASSETS
    });
    const doc = await loading.promise;
    if (generation !== this.generation) {
      await doc.destroy();
      return;
    }

    this.doc = doc;
    this.totalPages = doc.numPages;
    if (this.totalPages < 1) return;

    const first = await doc.getPage(1);
    const firstViewport = first.getViewport({ scale: 1 });
    const firstSize: PageSize = { width: firstViewport.width, height: firstViewport.height };
    this.pageSizes.set(1, firstSize);

    for (let page = 1; page <= this.totalPages; page += 1) {
      const shell = this.pagesEl.createDiv({ cls: "latextifier-pdf-page" });
      shell.dataset.page = String(page);
      shell.setAttribute("aria-label", "PDF page " + String(page));
      this.applyShellSize(shell, this.pageSizes.get(page) ?? firstSize);
      this.observer.observe(shell);
    }

    await this.renderPage(Math.min(anchor.page, this.totalPages));
    window.requestAnimationFrame(() => {
      this.restoreAnchor({
        page: Math.min(anchor.page, this.totalPages),
        offset: anchor.offset
      });
      this.emitStatus();
    });
  }

  clear(message = "No PDF yet."): void {
    this.generation += 1;
    void this.destroyDocument();
    this.resetPages();
    this.totalPages = 0;
    this.pagesEl.createDiv({ cls: "latextifier-pdf-empty", text: message });
    this.emitStatus();
  }

  destroy(): void {
    this.generation += 1;
    this.observer.disconnect();
    for (const task of this.renderTasks.values()) task.cancel();
    this.renderTasks.clear();
    void this.destroyDocument();
    this.host.empty();
  }

  zoomIn(): void {
    this.setScale(this.scale * 1.15);
  }

  zoomOut(): void {
    this.setScale(this.scale / 1.15);
  }

  fitWidth(): void {
    const size = this.pageSizes.get(this.currentPage()) ?? this.pageSizes.get(1);
    if (!size || this.scrollEl.clientWidth <= 32) return;
    this.setScale((this.scrollEl.clientWidth - 32) / (size.width * CSS_PER_PT));
  }

  async reveal(box: PdfBox): Promise<void> {
    if (!this.doc || box.page < 1 || box.page > this.totalPages) return;
    await this.renderPage(box.page);
    const shell = this.shell(box.page);
    if (!shell) return;

    const top = shell.offsetTop + box.y * CSS_PER_PT * this.scale;
    this.scrollEl.scrollTo({ top: Math.max(0, top - 72), behavior: "smooth" });

    this.highlight?.remove();
    const mark = shell.createDiv({ cls: "latextifier-pdf-highlight" });
    mark.style.left = String(box.x * CSS_PER_PT * this.scale) + "px";
    mark.style.top = String(box.y * CSS_PER_PT * this.scale) + "px";
    mark.style.width = String(Math.max(8, box.width * CSS_PER_PT * this.scale)) + "px";
    mark.style.height = String(Math.max(8, box.height * CSS_PER_PT * this.scale)) + "px";
    this.highlight = mark;
    window.setTimeout(() => {
      if (this.highlight === mark) {
        mark.remove();
        this.highlight = null;
      }
    }, 1800);
  }

  getScale(): number {
    return this.scale;
  }

  currentPage(): number {
    if (this.totalPages < 1) return 0;
    const top = this.scrollEl.scrollTop + 24;
    let page = 1;
    for (let number = 1; number <= this.totalPages; number += 1) {
      const shell = this.shell(number);
      if (!shell) continue;
      if (shell.offsetTop <= top) page = number;
      else break;
    }
    return page;
  }

  private async renderPage(pageNumber: number): Promise<void> {
    const doc = this.doc;
    if (!doc || this.rendered.has(pageNumber) || this.renderTasks.has(pageNumber)) return;
    const shell = this.shell(pageNumber);
    if (!shell) return;

    const generation = this.generation;
    const page = await doc.getPage(pageNumber);
    if (generation !== this.generation) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const size: PageSize = { width: baseViewport.width, height: baseViewport.height };
    this.pageSizes.set(pageNumber, size);
    this.applyShellSize(shell, size);

    const cssViewport = page.getViewport({ scale: CSS_PER_PT * this.scale });
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const renderViewport = page.getViewport({ scale: CSS_PER_PT * this.scale * dpr });

    shell.empty();
    const canvas = shell.createEl("canvas", { cls: "latextifier-pdf-canvas" });
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    canvas.style.width = String(cssViewport.width) + "px";
    canvas.style.height = String(cssViewport.height) + "px";

    const context = canvas.getContext("2d");
    if (!context) return;
    const task = page.render({ canvasContext: context, canvas, viewport: renderViewport });
    this.renderTasks.set(pageNumber, task);

    try {
      await task.promise;
      if (generation !== this.generation) return;
      this.rendered.add(pageNumber);
      await this.renderTextLayer(page, shell, cssViewport, generation);
    } catch {
      if (generation === this.generation) shell.empty();
    } finally {
      this.renderTasks.delete(pageNumber);
      this.trimRendered();
    }
  }

  private async renderTextLayer(
    page: PdfPage,
    shell: HTMLElement,
    viewport: PdfViewport,
    generation: number
  ): Promise<void> {
    const TextLayer = this.pdfjs?.TextLayer;
    if (!TextLayer || !page.getTextContent) return;

    try {
      const source = await page.getTextContent();
      if (generation !== this.generation) return;
      const layer = shell.createDiv({ cls: "textLayer latextifier-text-layer" });
      const task = new TextLayer({
        textContentSource: source,
        container: layer,
        viewport
      });
      await task.render();
    } catch {
      // Text selection is an enhancement; the canvas remains usable.
    }
  }

  private pointFromEvent(event: MouseEvent): PdfPoint | null {
    const target = event.target as HTMLElement | null;
    const shell = target?.closest<HTMLElement>(".latextifier-pdf-page");
    if (!shell) return null;
    const page = Number(shell.dataset.page);
    if (!Number.isFinite(page)) return null;
    const rect = shell.getBoundingClientRect();
    const factor = CSS_PER_PT * this.scale;
    return {
      page,
      x: Math.max(0, (event.clientX - rect.left) / factor),
      y: Math.max(0, (event.clientY - rect.top) / factor)
    };
  }

  private setScale(next: number): void {
    const clamped = Math.min(4, Math.max(0.25, next));
    if (Math.abs(clamped - this.scale) < 0.001) return;
    const anchor = this.captureAnchor();
    this.scale = clamped;

    for (let page = 1; page <= this.totalPages; page += 1) {
      const shell = this.shell(page);
      const size = this.pageSizes.get(page) ?? this.pageSizes.get(1);
      if (shell && size) this.applyShellSize(shell, size);
      this.unrender(page);
    }

    window.requestAnimationFrame(() => {
      this.restoreAnchor(anchor);
      for (const page of this.visiblePages) void this.renderPage(page);
      if (this.visiblePages.size === 0 && anchor.page > 0) void this.renderPage(anchor.page);
      this.emitStatus();
    });
  }

  private trimRendered(): void {
    if (this.rendered.size <= 12) return;
    const current = this.currentPage();
    const candidates = [...this.rendered]
      .filter((page) => !this.visiblePages.has(page))
      .sort((a, b) => Math.abs(b - current) - Math.abs(a - current));
    for (const page of candidates) {
      if (this.rendered.size <= 12) break;
      this.unrender(page);
    }
  }

  private unrender(page: number): void {
    this.renderTasks.get(page)?.cancel();
    this.renderTasks.delete(page);
    if (!this.rendered.delete(page)) return;
    this.shell(page)?.empty();
  }

  private applyShellSize(shell: HTMLElement, size: PageSize): void {
    shell.style.width = String(size.width * CSS_PER_PT * this.scale) + "px";
    shell.style.height = String(size.height * CSS_PER_PT * this.scale) + "px";
  }

  private captureAnchor(): Anchor {
    const page = this.currentPage() || 1;
    const shell = this.shell(page);
    return { page, offset: shell ? this.scrollEl.scrollTop - shell.offsetTop : 0 };
  }

  private restoreAnchor(anchor: Anchor): void {
    const shell = this.shell(anchor.page);
    if (shell) this.scrollEl.scrollTop = Math.max(0, shell.offsetTop + anchor.offset);
  }

  private shell(page: number): HTMLElement | null {
    return this.pagesEl.querySelector<HTMLElement>('[data-page="' + String(page) + '"]');
  }

  private resetPages(): void {
    this.observer.disconnect();
    for (const task of this.renderTasks.values()) task.cancel();
    this.renderTasks.clear();
    this.visiblePages.clear();
    this.rendered.clear();
    this.pageSizes.clear();
    this.highlight = null;
    this.pagesEl.empty();
  }

  private async destroyDocument(): Promise<void> {
    const doc = this.doc;
    this.doc = null;
    if (!doc) return;
    try {
      await doc.destroy();
    } catch {
      // Destruction races are harmless during reload/unload.
    }
  }

  private emitStatus(): void {
    this.callbacks.onStatus?.(this.currentPage(), this.totalPages, this.scale);
  }
}
