import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from "@codemirror/view";
import { searchKeymap } from "@codemirror/search";
import { Notice, TextFileView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type LatextifierPlugin from "../main";
import type { BuildMode, Diagnostic } from "../types";
import type { LatexSession, SessionEvent } from "../core/session";
import type { PdfPoint } from "../pdf/pdf-renderer";
import { PdfRenderer } from "../pdf/pdf-renderer";
import { latexCompletionSource } from "./completion";
import { latexHighlightExtension } from "./highlight";

export const LATEX_VIEW_TYPE = "latextifier-tex-editor";

export class LatexEditorView extends TextFileView {
  private editor: EditorView | null = null;
  private loadedText = "";
  private saveTimer: number | null = null;
  private applyingExternalData = false;
  private session: LatexSession | null = null;
  private sessionRoot: string | null = null;
  private detachSession: (() => void) | null = null;
  private renderer: PdfRenderer | null = null;
  private statusEl: HTMLElement | null = null;
  private problemsEl: HTMLDetailsElement | null = null;
  private previewPane: HTMLElement | null = null;
  private previewVisible = true;

  constructor(leaf: WorkspaceLeaf, readonly plugin: LatextifierPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return LATEX_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "LaTeX";
  }

  getIcon(): string {
    return "sigma";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("latextifier-view");

    const shell = this.contentEl.createDiv({ cls: "latextifier-shell" });
    const toolbar = shell.createDiv({ cls: "latextifier-toolbar" });
    this.statusEl = toolbar.createDiv({ cls: "latextifier-status", text: "Ready" });

    const actions = toolbar.createDiv({ cls: "latextifier-actions" });
    this.addToolbarButton(actions, "play", "Compile", () => void this.compile("fast"));
    this.addToolbarButton(actions, "hammer", "Full build", () => void this.compile("full"));
    this.addToolbarButton(actions, "locate-fixed", "Forward SyncTeX", () => void this.forwardSearch());
    this.addToolbarButton(actions, "panel-right", "Toggle PDF", () => this.togglePreview());
    this.addToolbarButton(actions, "zoom-out", "Zoom out", () => this.renderer?.zoomOut());
    this.addToolbarButton(actions, "zoom-in", "Zoom in", () => this.renderer?.zoomIn());
    this.addToolbarButton(actions, "move-horizontal", "Fit width", () => this.renderer?.fitWidth());

    this.problemsEl = shell.createEl("details", { cls: "latextifier-problems" });
    this.renderProblems([]);

    const work = shell.createDiv({ cls: "latextifier-workspace" });
    const editorPane = work.createDiv({ cls: "latextifier-editor-pane" });
    this.previewPane = work.createDiv({ cls: "latextifier-preview-pane" });

    this.editor = new EditorView({
      parent: editorPane,
      state: EditorState.create({
        doc: this.loadedText,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          latexHighlightExtension(),
          autocompletion({ override: [latexCompletionSource], activateOnTyping: true }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.applyingExternalData) this.scheduleSave();
          })
        ]
      })
    });

    this.previewVisible = this.plugin.settings.previewVisibleByDefault;
    this.renderer = new PdfRenderer(this.previewPane, {
      onInversePoint: (point) => void this.inverseSearch(point),
      onStatus: (page, pages, scale) => {
        if (pages > 0 && this.statusEl && !this.session?.compiler.compiling) {
          this.statusEl.setText("PDF " + String(page) + "/" + String(pages) + " · " + String(Math.round(scale * 100)) + "%");
        }
      }
    });
    this.applyPreviewVisibility();
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    await this.attachSession(file);
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.cancelSaveTimer();
    await this.save();
    this.detachCurrentSession();
    await super.onUnloadFile(file);
  }

  async onClose(): Promise<void> {
    this.cancelSaveTimer();
    try {
      await this.save();
    } catch {
      // Closing should not be blocked by a failed final save.
    }
    this.detachCurrentSession();
    this.renderer?.destroy();
    this.renderer = null;
    this.editor?.destroy();
    this.editor = null;
  }

  getViewData(): string {
    return this.editor?.state.doc.toString() ?? this.loadedText;
  }

  setViewData(data: string, _clear: boolean): void {
    this.loadedText = data;
    if (!this.editor) return;
    const current = this.editor.state.doc.toString();
    if (current === data) return;

    this.applyingExternalData = true;
    try {
      this.editor.dispatch({
        changes: { from: 0, to: current.length, insert: data },
        annotations: Transaction.addToHistory.of(false)
      });
    } finally {
      this.applyingExternalData = false;
    }
  }

  clear(): void {
    this.setViewData("", true);
  }

  async compile(mode: BuildMode): Promise<void> {
    await this.flushSave();
    if (!this.session) {
      new Notice("No TeX project session is attached.");
      return;
    }
    this.session.request(mode);
  }

  async forwardSearch(): Promise<void> {
    if (!this.session || !this.file || !this.editor) return;
    await this.flushSave();
    const head = this.editor.state.selection.main.head;
    const line = this.editor.state.doc.lineAt(head);
    const box = await this.plugin.forwardSearch(
      this.session,
      this.file,
      line.number,
      head - line.from
    );
    if (!box) {
      new Notice("SyncTeX could not map the current cursor position.");
      return;
    }
    await this.renderer?.reveal(box);
  }

  togglePreview(): void {
    this.previewVisible = !this.previewVisible;
    this.applyPreviewVisibility();
  }

  focusLocation(line: number, column = 0): void {
    if (!this.editor || line < 1 || line > this.editor.state.doc.lines) return;
    const target = this.editor.state.doc.line(line);
    const anchor = Math.min(target.to, target.from + Math.max(0, column));
    this.editor.dispatch({ selection: { anchor }, scrollIntoView: true });
    this.editor.focus();
  }

  private async attachSession(file: TFile): Promise<void> {
    this.detachCurrentSession();
    const handle = await this.plugin.acquireSessionFor(file);
    if (this.file !== file) {
      this.plugin.releaseSession(handle.root);
      return;
    }

    this.sessionRoot = handle.root;
    this.session = handle.session;
    this.detachSession = handle.session.on((event) => this.onSessionEvent(event));

    const previous = handle.session.lastResult;
    if (previous?.pdfData) {
      await this.renderer?.load(previous.pdfData);
      this.renderProblems(previous.diagnostics);
    } else if (this.plugin.settings.autoCompile) {
      handle.session.request("fast");
    }
  }

  private detachCurrentSession(): void {
    this.detachSession?.();
    this.detachSession = null;
    if (this.sessionRoot) this.plugin.releaseSession(this.sessionRoot);
    this.sessionRoot = null;
    this.session = null;
  }

  private onSessionEvent(event: SessionEvent): void {
    if (event.type === "start") {
      this.statusEl?.setText(event.mode === "full" ? "Full build…" : "Compiling…");
      return;
    }

    if (event.type === "failure") {
      this.statusEl?.setText("Build failed");
      new Notice(event.error.message, 7000);
      return;
    }

    const result = event.result;
    this.statusEl?.setText(
      result.ok
        ? result.engine + " · " + (result.durationMs / 1000).toFixed(2) + "s"
        : "Build failed"
    );
    this.renderProblems(result.diagnostics);

    if (result.ok && result.pdfData) {
      void this.renderer?.load(result.pdfData);
    } else {
      const first = result.diagnostics.find((item) => item.severity === "error");
      if (first?.line && !first.file) this.focusLocation(first.line, first.column);
      if (first) new Notice(first.message, 7000);
    }
  }

  private renderProblems(diagnostics: Diagnostic[]): void {
    if (!this.problemsEl) return;
    const wasOpen = this.problemsEl.open;
    this.problemsEl.empty();
    this.problemsEl.createEl("summary", {
      text: diagnostics.length ? "Problems (" + String(diagnostics.length) + ")" : "Problems"
    });
    this.problemsEl.open = wasOpen;

    if (diagnostics.length === 0) {
      this.problemsEl.createDiv({ cls: "latextifier-problem-empty", text: "No compiler diagnostics." });
      return;
    }

    for (const diagnostic of diagnostics.slice(0, 80)) {
      const row = this.problemsEl.createEl("button", {
        cls: "latextifier-problem latextifier-problem-" + diagnostic.severity
      });
      row.createSpan({ cls: "latextifier-problem-message", text: diagnostic.message });
      if (diagnostic.line) {
        row.createSpan({ cls: "latextifier-problem-line", text: "line " + String(diagnostic.line) });
        row.addEventListener("click", () => this.focusLocation(diagnostic.line ?? 1, diagnostic.column));
      } else {
        row.disabled = true;
      }
    }
  }

  private async inverseSearch(point: PdfPoint): Promise<void> {
    if (!this.session) return;
    const location = await this.plugin.inverseSearch(this.session, point);
    if (!location) {
      new Notice("SyncTeX could not map that PDF position.");
      return;
    }
    await this.plugin.openSourceLocation(this.leaf, location);
  }

  private scheduleSave(): void {
    this.cancelSaveTimer();
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save().then(() => {
        if (this.plugin.settings.autoCompile) this.session?.request("fast");
      }).catch((error) => {
        new Notice("Could not save TeX file: " + String(error));
      });
    }, this.plugin.settings.compileDebounceMs);
  }

  private async flushSave(): Promise<void> {
    this.cancelSaveTimer();
    await this.save();
  }

  private cancelSaveTimer(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private applyPreviewVisibility(): void {
    this.previewPane?.toggleClass("is-hidden", !this.previewVisible);
    this.contentEl.toggleClass("latextifier-preview-hidden", !this.previewVisible);
  }

  private addToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    action: () => void
  ): void {
    const button = parent.createEl("button", {
      cls: "clickable-icon latextifier-toolbar-button",
      attr: { "aria-label": label }
    });
    setIcon(button, icon);
    button.addEventListener("click", action);
  }
}
