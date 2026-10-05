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
import type { BuildMode, Diagnostic, SourceLocation } from "../types";
import type { LatexSession, SessionEvent } from "../core/session";
import type { PdfPoint } from "../pdf/pdf-renderer";
import { PdfRenderer } from "../pdf/pdf-renderer";
import { createLatexCompletionSource } from "./completion";
import { createTexlabCompletionSource } from "./texlab-completion";
import { latexHighlightExtension } from "./highlight";
import { ProjectNavigator } from "./project-navigator";
import { smartEditingExtension } from "./smart-editing";
import { liveLatexReadingExtension, refreshLiveLatexEffect } from "./live-latex";

export const LATEX_VIEW_TYPE = "latextifier-tex-editor";

export class LatexEditorView extends TextFileView {
  private editor: EditorView | null = null;
  private loadedText = "";
  private saveTimer: number | null = null;
  private texlabChangeTimer: number | null = null;
  private sourceSyncTimer: number | null = null;
  private applyingExternalData = false;
  private session: LatexSession | null = null;
  private sessionRoot: string | null = null;
  private detachSession: (() => void) | null = null;
  private renderer: PdfRenderer | null = null;
  private navigator: ProjectNavigator | null = null;
  private statusEl: HTMLElement | null = null;
  private problemsEl: HTMLDetailsElement | null = null;
  private previewPane: HTMLElement | null = null;
  private navigatorPane: HTMLElement | null = null;
  private previewVisible = true;
  private navigatorVisible = true;
  private continuousSync = true;
  private liveLatex = true;
  private syncGuardUntil = 0;
  private scrollLockButton: HTMLButtonElement | null = null;
  private navigatorButton: HTMLButtonElement | null = null;
  private liveLatexButton: HTMLButtonElement | null = null;

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
    this.scrollLockButton = this.addToolbarButton(actions, "link", "Toggle continuous source and PDF sync", () => this.toggleContinuousSync());
    this.navigatorButton = this.addToolbarButton(actions, "panel-left", "Toggle project navigator", () => this.toggleNavigator());
    this.liveLatexButton = this.addToolbarButton(actions, "eye", "Toggle live LaTeX reading", () => this.toggleLiveLatex());
    this.addToolbarButton(actions, "book-open", "TexLab hover information", () => void this.showTexlabHover());
    this.addToolbarButton(actions, "panel-right", "Toggle PDF", () => this.togglePreview());
    this.addToolbarButton(actions, "zoom-out", "Zoom out", () => this.renderer?.zoomOut());
    this.addToolbarButton(actions, "zoom-in", "Zoom in", () => this.renderer?.zoomIn());
    this.addToolbarButton(actions, "move-horizontal", "Fit width", () => this.renderer?.fitWidth());

    this.problemsEl = shell.createEl("details", { cls: "latextifier-problems" });
    this.renderProblems([]);

    const work = shell.createDiv({ cls: "latextifier-workspace" });
    this.navigatorPane = work.createDiv({ cls: "latextifier-navigator-pane" });
    const editorPane = work.createDiv({ cls: "latextifier-editor-pane" });
    this.previewPane = work.createDiv({ cls: "latextifier-preview-pane" });

    this.navigator = new ProjectNavigator(this.navigatorPane, {
      onOpen: (location) => void this.openProjectLocation(location, true)
    });

    const projectCompletion = createLatexCompletionSource(
      () => this.session?.index.current ?? null,
      () => this.plugin.settings.autoCloseEnvironment
    );
    const texlabCompletion = createTexlabCompletionSource(
      () => this.session?.texlab ?? null,
      () => this.file ? this.plugin.absolutePath(this.file.path) : null
    );

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
          liveLatexReadingExtension(
            () => this.liveLatex,
            () => this.session?.index.current ?? null,
            (source, container) => this.plugin.renderLatexBlock(source, container)
          ),
          smartEditingExtension(() => this.plugin.settings),
          autocompletion({
            override: [projectCompletion, texlabCompletion],
            activateOnTyping: true,
            maxRenderedOptions: 100
          }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.applyingExternalData) {
              this.scheduleSave();
              this.scheduleTexlabChange();
            }
          })
        ]
      })
    });
    this.editor.scrollDOM.addEventListener("scroll", () => this.scheduleSourceSync(), { passive: true });

    this.previewVisible = this.plugin.settings.previewVisibleByDefault;
    this.navigatorVisible = this.plugin.settings.navigatorVisibleByDefault;
    this.continuousSync = this.plugin.settings.continuousSyncByDefault;
    this.liveLatex = this.plugin.settings.liveLatexByDefault;

    this.renderer = new PdfRenderer(this.previewPane, {
      onInversePoint: (point) => void this.inverseSearch(point, true),
      onScrollPoint: (point) => void this.handlePdfScroll(point),
      onStatus: (page, pages, scale) => {
        if (pages > 0 && this.statusEl && !this.session?.compiler.compiling) {
          this.statusEl.setText("PDF " + String(page) + "/" + String(pages) + " · " + String(Math.round(scale * 100)) + "%");
        }
      }
    });
    this.applyVisibility();
    this.updateToggleButtons();
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    await this.attachSession(file);
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.cancelTimers();
    this.session?.texlab.close(this.plugin.absolutePath(file.path));
    await this.save();
    this.detachCurrentSession();
    await super.onUnloadFile(file);
  }

  async onClose(): Promise<void> {
    this.cancelTimers();
    if (this.file) this.session?.texlab.close(this.plugin.absolutePath(this.file.path));
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
    this.navigator = null;
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
    this.scheduleTexlabChange();
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
    this.guardSync(420);
    await this.renderer?.reveal(box);
  }

  togglePreview(): void {
    this.previewVisible = !this.previewVisible;
    this.applyVisibility();
  }

  toggleNavigator(): void {
    this.navigatorVisible = !this.navigatorVisible;
    this.applyVisibility();
    this.updateToggleButtons();
  }

  toggleContinuousSync(): void {
    this.continuousSync = !this.continuousSync;
    this.updateToggleButtons();
    if (this.continuousSync) this.scheduleSourceSync();
  }

  toggleLiveLatex(): void {
    this.liveLatex = !this.liveLatex;
    this.editor?.dispatch({ effects: refreshLiveLatexEffect.of(undefined) });
    this.updateToggleButtons();
  }

  focusLocation(line: number, column = 0, focus = true): void {
    if (!this.editor || line < 1 || line > this.editor.state.doc.lines) return;
    const target = this.editor.state.doc.line(line);
    const anchor = Math.min(target.to, target.from + Math.max(0, column));
    this.editor.dispatch({ selection: { anchor }, scrollIntoView: true });
    if (focus) this.editor.focus();
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

    if (handle.session.index.current.updatedAt > 0) {
      this.navigator?.setSnapshot(handle.session.index.current);
    }

    void handle.session.texlab.open(this.plugin.absolutePath(file.path), this.getViewData());

    const previous = handle.session.lastResult;
    if (previous?.pdfData) {
      await this.renderer?.load(previous.pdfData);
      this.renderCombinedProblems(previous.diagnostics);
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

    if (event.type === "index") {
      this.navigator?.setSnapshot(event.snapshot);
      this.editor?.dispatch({ effects: refreshLiveLatexEffect.of(undefined) });
      return;
    }

    if (event.type === "texlab-diagnostics") {
      if (this.file && this.plugin.absolutePath(this.file.path) === event.file) {
        this.renderCombinedProblems(this.session?.lastResult?.diagnostics ?? []);
      }
      return;
    }

    if (event.type === "texlab-status") {
      if (event.status === "ready" && !this.session?.compiler.compiling) this.statusEl?.setText("TexLab ready");
      return;
    }

    if (event.type === "failure") {
      this.statusEl?.setText("Build or language service failed");
      new Notice(event.error.message, 7000);
      return;
    }

    const result = event.result;
    this.statusEl?.setText(
      result.ok
        ? result.engine + " · " + (result.durationMs / 1000).toFixed(2) + "s"
        : "Build failed"
    );
    this.renderCombinedProblems(result.diagnostics);

    if (result.ok && result.pdfData) {
      void this.renderer?.load(result.pdfData);
    } else {
      const first = result.diagnostics.find((item) => item.severity === "error");
      if (first?.line && !first.file) this.focusLocation(first.line, first.column);
      if (first) new Notice(first.message, 7000);
    }
  }

  private renderCombinedProblems(compilerDiagnostics: Diagnostic[]): void {
    if (!this.file || !this.session) {
      this.renderProblems(compilerDiagnostics);
      return;
    }
    const file = this.plugin.absolutePath(this.file.path);
    const texlab = this.session.texlabDiagnostics.get(file) ?? [];
    this.renderProblems(dedupeDiagnostics([...compilerDiagnostics, ...texlab]));
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
      this.problemsEl.createDiv({ cls: "latextifier-problem-empty", text: "No compiler or TexLab diagnostics." });
      return;
    }

    for (const diagnostic of diagnostics.slice(0, 120)) {
      const row = this.problemsEl.createEl("button", {
        cls: "latextifier-problem latextifier-problem-" + diagnostic.severity,
        attr: { type: "button" }
      });
      row.createSpan({ cls: "latextifier-problem-message", text: diagnostic.message });
      if (diagnostic.line) {
        row.createSpan({ cls: "latextifier-problem-line", text: "line " + String(diagnostic.line) });
        row.addEventListener("click", () => {
          if (diagnostic.file && this.file && diagnostic.file !== this.plugin.absolutePath(this.file.path)) {
            void this.openProjectLocation({
              file: diagnostic.file,
              line: diagnostic.line ?? 1,
              column: diagnostic.column ?? 0
            }, true);
          } else {
            this.focusLocation(diagnostic.line ?? 1, diagnostic.column);
          }
        });
      } else {
        row.disabled = true;
      }
    }
  }

  private async inverseSearch(point: PdfPoint, focus: boolean): Promise<void> {
    if (!this.session) return;
    const location = await this.plugin.inverseSearch(this.session, point);
    if (!location) {
      if (focus) new Notice("SyncTeX could not map that PDF position.");
      return;
    }
    await this.openProjectLocation(location, focus);
  }

  private async handlePdfScroll(point: PdfPoint): Promise<void> {
    if (!this.continuousSync || this.isSyncGuarded() || !this.session) return;
    this.guardSync(360);
    await this.inverseSearch(point, false);
  }

  private scheduleSourceSync(): void {
    if (!this.continuousSync || this.isSyncGuarded() || !this.editor || !this.file || !this.session) return;
    if (this.sourceSyncTimer !== null) window.clearTimeout(this.sourceSyncTimer);
    this.sourceSyncTimer = window.setTimeout(() => {
      this.sourceSyncTimer = null;
      void this.syncSourceViewportToPdf();
    }, 140);
  }

  private async syncSourceViewportToPdf(): Promise<void> {
    if (!this.continuousSync || this.isSyncGuarded() || !this.editor || !this.file || !this.session) return;
    const block = this.editor.lineBlockAtHeight(this.editor.scrollDOM.scrollTop + 24);
    const line = this.editor.state.doc.lineAt(block.from);
    const box = await this.plugin.forwardSearch(
      this.session,
      this.file,
      line.number,
      0
    );
    if (!box || !this.continuousSync) return;
    this.guardSync(360);
    await this.renderer?.reveal(box);
  }

  private async showTexlabHover(): Promise<void> {
    if (!this.editor || !this.file || !this.session) return;
    const head = this.editor.state.selection.main.head;
    const line = this.editor.state.doc.lineAt(head);
    const hover = await this.session.texlab.hover(
      this.plugin.absolutePath(this.file.path),
      line.number,
      head - line.from
    );
    if (!hover?.markdown) {
      new Notice("No TexLab information at the cursor.");
      return;
    }
    new Notice(hover.markdown.slice(0, 3500), 9000);
  }

  private async openProjectLocation(location: SourceLocation, focus: boolean): Promise<void> {
    this.guardSync(420);
    await this.plugin.openSourceLocation(this.leaf, location, focus);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save().then(() => {
        if (this.plugin.settings.autoCompile) this.session?.request("fast");
      }).catch((error) => {
        new Notice("Could not save TeX file: " + String(error));
      });
    }, this.plugin.settings.compileDebounceMs);
  }

  private scheduleTexlabChange(): void {
    if (!this.file || !this.session) return;
    if (this.texlabChangeTimer !== null) window.clearTimeout(this.texlabChangeTimer);
    this.texlabChangeTimer = window.setTimeout(() => {
      this.texlabChangeTimer = null;
      if (!this.file || !this.session) return;
      void this.session.texlab.change(this.plugin.absolutePath(this.file.path), this.getViewData());
    }, 120);
  }

  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  private cancelTimers(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.texlabChangeTimer !== null) window.clearTimeout(this.texlabChangeTimer);
    if (this.sourceSyncTimer !== null) window.clearTimeout(this.sourceSyncTimer);
    this.saveTimer = null;
    this.texlabChangeTimer = null;
    this.sourceSyncTimer = null;
  }

  private guardSync(durationMs: number): void {
    this.syncGuardUntil = Date.now() + durationMs;
  }

  private isSyncGuarded(): boolean {
    return Date.now() < this.syncGuardUntil;
  }

  private applyVisibility(): void {
    this.previewPane?.toggleClass("is-hidden", !this.previewVisible);
    this.navigatorPane?.toggleClass("is-hidden", !this.navigatorVisible);
    this.contentEl.toggleClass("latextifier-preview-hidden", !this.previewVisible);
    this.contentEl.toggleClass("latextifier-navigator-hidden", !this.navigatorVisible);
  }

  private updateToggleButtons(): void {
    setPressed(this.scrollLockButton, this.continuousSync);
    setPressed(this.navigatorButton, this.navigatorVisible);
    setPressed(this.liveLatexButton, this.liveLatex);
  }

  private addToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    action: () => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "clickable-icon latextifier-toolbar-button",
      attr: { "aria-label": label, type: "button" }
    });
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }
}

function setPressed(button: HTMLButtonElement | null, pressed: boolean): void {
  if (!button) return;
  button.toggleClass("is-active", pressed);
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
}

function dedupeDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const item of items) {
    const key = [item.severity, item.file ?? "", item.line ?? "", item.column ?? "", item.message].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
