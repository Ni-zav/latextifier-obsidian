import { dirname, relative, resolve, sep } from "node:path";
import {
  FileSystemAdapter,
  Notice,
  Plugin,
  TFile,
  normalizePath,
  type WorkspaceLeaf
} from "obsidian";
import { LatexEditorView, LATEX_VIEW_TYPE } from "./editor/latex-view";
import { FragmentCompiler } from "./markdown/fragment-compiler";
import { latexBlockLivePreview } from "./markdown/live-preview";
import { MarkdownLatexRenderer } from "./markdown/renderer";
import { resolveProjectRoot } from "./core/project";
import { SessionRegistry, type LatexSession } from "./core/session";
import { forwardSearch, inverseSearch } from "./core/synctex";
import { DEFAULT_SETTINGS, LatextifierSettingTab } from "./settings";
import type { LatextifierSettings, PdfBox, SourceLocation } from "./types";
import type { PdfPoint } from "./pdf/pdf-renderer";

export default class LatextifierPlugin extends Plugin {
  settings: LatextifierSettings = { ...DEFAULT_SETTINGS };
  private sessions!: SessionRegistry;
  private fragmentCompiler!: FragmentCompiler;
  private markdownRenderer!: MarkdownLatexRenderer;
  private statusEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.sessions = new SessionRegistry(() => this.settings);
    this.fragmentCompiler = new FragmentCompiler(() => this.settings);
    this.markdownRenderer = new MarkdownLatexRenderer(this.fragmentCompiler);

    this.registerView(LATEX_VIEW_TYPE, (leaf) => new LatexEditorView(leaf, this));
    this.registerExtensions(["tex", "sty", "cls"], LATEX_VIEW_TYPE);

    this.registerMarkdownCodeBlockProcessor("latex", async (source, el) => {
      await this.markdownRenderer.render(source, el);
    });
    this.registerMarkdownCodeBlockProcessor("tex", async (source, el) => {
      await this.markdownRenderer.render(source, el);
    });
    this.registerEditorExtension(latexBlockLivePreview(this.markdownRenderer));

    const projectExtensions = new Set(["tex", "sty", "cls", "bib"]);
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && projectExtensions.has(file.extension.toLowerCase())) {
        this.sessions.notifyChanged(this.absolutePath(file.path), true);
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && projectExtensions.has(file.extension.toLowerCase())) {
        this.sessions.notifyChanged(this.absolutePath(file.path), true);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && projectExtensions.has(file.extension.toLowerCase())) {
        this.sessions.notifyChanged(this.absolutePath(file.path), true);
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && projectExtensions.has(file.extension.toLowerCase())) {
        this.sessions.notifyChanged(this.absolutePath(oldPath), false);
        this.sessions.notifyChanged(this.absolutePath(file.path), true);
      }
    }));

    this.addSettingTab(new LatextifierSettingTab(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.setStatus("Latextifier ready");

    this.addRibbonIcon("sigma", "Compile active TeX document", () => {
      void this.activeTexView()?.compile("fast");
    });

    this.addCommand({
      id: "compile-active-tex",
      name: "Compile active TeX document",
      checkCallback: (checking) => this.withActiveTexView(checking, (view) => void view.compile("fast"))
    });

    this.addCommand({
      id: "full-build-active-tex",
      name: "Full build active TeX document",
      checkCallback: (checking) => this.withActiveTexView(checking, (view) => void view.compile("full"))
    });

    this.addCommand({
      id: "forward-synctex",
      name: "Forward SyncTeX from cursor",
      checkCallback: (checking) => this.withActiveTexView(checking, (view) => void view.forwardSearch())
    });

    this.addCommand({
      id: "toggle-tex-pdf-preview",
      name: "Toggle TeX PDF preview",
      checkCallback: (checking) => this.withActiveTexView(checking, (view) => view.togglePreview())
    });

    this.addCommand({
      id: "toggle-continuous-synctex",
      name: "Toggle continuous source and PDF sync",
      checkCallback: (checking) => this.withActiveTexView(checking, (view) => view.toggleContinuousSync())
    });

    this.addCommand({
      id: "toggle-project-navigator",
      name: "Toggle LaTeX project navigator",
      checkCallback: (checking) => this.withActiveTexView(checking, (view) => view.toggleNavigator())
    });

    this.addCommand({
      id: "toggle-live-latex-reading",
      name: "Toggle live LaTeX reading",
      checkCallback: (checking) => this.withActiveTexView(checking, (view) => view.toggleLiveLatex())
    });

    this.addCommand({
      id: "insert-latex-block",
      name: "Insert LaTeX block",
      editorCallback: (editor) => {
        const fence = String.fromCharCode(96).repeat(3);
        editor.replaceSelection(fence + "latex\n% latextifier: auto\n\n" + fence);
        const cursor = editor.getCursor();
        editor.setCursor({ line: Math.max(0, cursor.line - 1), ch: 0 });
      }
    });
  }

  onunload(): void {
    this.sessions?.dispose();
    this.fragmentCompiler?.clear();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onFragmentSettingsChanged(): void {
    this.fragmentCompiler.clear();
  }

  async renderLatexBlock(source: string, container: HTMLElement): Promise<void> {
    await this.markdownRenderer.render(source, container);
  }

  async acquireSessionFor(file: TFile): Promise<{ root: string; session: LatexSession }> {
    const root = await resolveProjectRoot(this.absolutePath(file.path), this.vaultRoot());
    return { root, session: this.sessions.acquire(root) };
  }

  releaseSession(root: string): void {
    this.sessions.release(root);
  }

  async forwardSearch(
    session: LatexSession,
    file: TFile,
    line: number,
    column: number
  ): Promise<PdfBox | null> {
    const result = session.lastResult;
    if (!result?.ok) return null;
    try {
      return await forwardSearch(
        this.settings.texBinDir,
        this.settings.synctexPath,
        result.pdfPath,
        this.absolutePath(file.path),
        line,
        column
      );
    } catch (error) {
      this.setStatus("SyncTeX unavailable");
      console.warn("Latextifier forward SyncTeX failed", error);
      return null;
    }
  }

  async inverseSearch(session: LatexSession, point: PdfPoint): Promise<SourceLocation | null> {
    const result = session.lastResult;
    if (!result?.ok) return null;
    try {
      return await inverseSearch(
        this.settings.texBinDir,
        this.settings.synctexPath,
        result.pdfPath,
        point.page,
        point.x,
        point.y,
        dirname(session.root)
      );
    } catch (error) {
      this.setStatus("SyncTeX unavailable");
      console.warn("Latextifier inverse SyncTeX failed", error);
      return null;
    }
  }

  async openSourceLocation(leaf: WorkspaceLeaf, location: SourceLocation, focus = true): Promise<void> {
    const root = this.vaultRoot();
    const rel = relative(root, resolve(location.file));
    if (!rel || rel === ".." || rel.startsWith(".." + sep)) {
      new Notice("SyncTeX target is outside this vault.");
      return;
    }

    const path = normalizePath(rel.split(sep).join("/"));
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile)) {
      new Notice("SyncTeX source is not indexed in this vault: " + path);
      return;
    }

    await leaf.openFile(target, { active: focus });
    if (leaf.view instanceof LatexEditorView) {
      leaf.view.focusLocation(location.line, location.column ?? 0, focus);
    }
  }

  absolutePath(vaultPath: string): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Latextifier requires a desktop filesystem vault.");
    }
    return adapter.getFullPath(vaultPath);
  }

  vaultRoot(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Latextifier requires a desktop filesystem vault.");
    }
    return adapter.getBasePath();
  }

  setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private activeTexView(): LatexEditorView | null {
    return this.app.workspace.getActiveViewOfType(LatexEditorView);
  }

  private withActiveTexView(
    checking: boolean,
    action: (view: LatexEditorView) => void
  ): boolean {
    const view = this.activeTexView();
    if (!view) return false;
    if (!checking) action(view);
    return true;
  }
}

function sanitizeSettings(value: unknown): LatextifierSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };

  const settings: LatextifierSettings = { ...DEFAULT_SETTINGS };
  if (typeof value.compileDebounceMs === "number" && Number.isFinite(value.compileDebounceMs)) {
    settings.compileDebounceMs = Math.max(100, Math.min(5000, value.compileDebounceMs));
  }
  if (typeof value.autoCompile === "boolean") settings.autoCompile = value.autoCompile;
  if (isEngine(value.defaultEngine)) settings.defaultEngine = value.defaultEngine;
  if (isEngine(value.fragmentEngine)) settings.fragmentEngine = value.fragmentEngine;
  if (typeof value.texBinDir === "string") settings.texBinDir = value.texBinDir.trim();
  if (typeof value.latexmkPath === "string") settings.latexmkPath = value.latexmkPath.trim();
  if (typeof value.synctexPath === "string") settings.synctexPath = value.synctexPath.trim();
  if (typeof value.dvisvgmPath === "string") settings.dvisvgmPath = value.dvisvgmPath.trim();
  if (typeof value.fragmentPreamble === "string") settings.fragmentPreamble = value.fragmentPreamble;
  if (typeof value.previewVisibleByDefault === "boolean") settings.previewVisibleByDefault = value.previewVisibleByDefault;
  if (typeof value.continuousSyncByDefault === "boolean") settings.continuousSyncByDefault = value.continuousSyncByDefault;
  if (typeof value.navigatorVisibleByDefault === "boolean") settings.navigatorVisibleByDefault = value.navigatorVisibleByDefault;
  if (typeof value.liveLatexByDefault === "boolean") settings.liveLatexByDefault = value.liveLatexByDefault;
  if (typeof value.autoCloseEnvironment === "boolean") settings.autoCloseEnvironment = value.autoCloseEnvironment;
  if (typeof value.autoContinueItems === "boolean") settings.autoContinueItems = value.autoContinueItems;
  if (typeof value.enableTexlab === "boolean") settings.enableTexlab = value.enableTexlab;
  if (typeof value.texlabPath === "string") settings.texlabPath = value.texlabPath.trim();
  if (typeof value.allowShellEscape === "boolean") settings.allowShellEscape = value.allowShellEscape;
  return settings;
}

function isEngine(value: unknown): value is LatextifierSettings["defaultEngine"] {
  return value === "pdflatex" || value === "xelatex" || value === "lualatex";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
