import { basename, relative } from "node:path";
import type {
  ProjectLocation,
  ProjectSnapshot
} from "../core/project-index";
import { searchProjectText } from "../core/project-index";

type NavigatorTab = "structure" | "todos" | "files" | "refs" | "citations";

export interface ProjectNavigatorCallbacks {
  onOpen(location: ProjectLocation): void;
}

export class ProjectNavigator {
  readonly element: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly searchEl: HTMLInputElement;
  private readonly bodyEl: HTMLDivElement;
  private activeTab: NavigatorTab = "structure";
  private snapshot: ProjectSnapshot | null = null;
  private searchGeneration = 0;

  constructor(
    host: HTMLElement,
    private readonly callbacks: ProjectNavigatorCallbacks
  ) {
    this.element = host.createDiv({ cls: "latextifier-navigator" });

    const header = this.element.createDiv({ cls: "latextifier-navigator-header" });
    this.searchEl = header.createEl("input", {
      cls: "latextifier-navigator-search",
      type: "search",
      attr: {
        placeholder: "Search project…",
        "aria-label": "Search LaTeX project"
      }
    });
    this.searchEl.addEventListener("input", () => void this.render());

    this.tabsEl = this.element.createDiv({ cls: "latextifier-navigator-tabs" });
    this.addTab("structure", "Structure");
    this.addTab("todos", "TODOs");
    this.addTab("files", "Files");
    this.addTab("refs", "Refs");
    this.addTab("citations", "Citations");

    this.bodyEl = this.element.createDiv({ cls: "latextifier-navigator-body" });
    this.renderEmpty("Indexing project…");
  }

  setSnapshot(snapshot: ProjectSnapshot): void {
    this.snapshot = snapshot;
    void this.render();
  }

  focusSearch(): void {
    this.searchEl.focus();
    this.searchEl.select();
  }

  private addTab(tab: NavigatorTab, label: string): void {
    const button = this.tabsEl.createEl("button", {
      cls: "latextifier-navigator-tab",
      text: label,
      attr: { type: "button" }
    });
    button.dataset.tab = tab;
    button.addEventListener("click", () => {
      this.activeTab = tab;
      this.searchEl.value = "";
      void this.render();
    });
  }

  private async render(): Promise<void> {
    const snapshot = this.snapshot;
    this.updateActiveTab();
    if (!snapshot) {
      this.renderEmpty("Indexing project…");
      return;
    }

    const query = this.searchEl.value.trim();
    if (query) {
      const generation = ++this.searchGeneration;
      this.renderEmpty("Searching…");
      const hits = await searchProjectText(snapshot, query, 200);
      if (generation !== this.searchGeneration) return;

      this.bodyEl.empty();
      if (hits.length === 0) {
        this.renderEmpty("No project matches.");
        return;
      }
      for (const hit of hits) {
        this.addLocationRow(
          hit,
          hit.text || "(blank line)",
          shortRelative(snapshot.root, hit.file) + ":" + String(hit.line),
          "latextifier-nav-search-hit"
        );
      }
      return;
    }

    this.searchGeneration += 1;
    this.bodyEl.empty();

    if (this.activeTab === "structure") {
      if (snapshot.outline.length === 0) return this.renderEmpty("No document structure found.");
      for (const item of snapshot.outline) {
        const row = this.addLocationRow(
          item,
          item.title,
          item.kind + " · " + shortRelative(snapshot.root, item.file) + ":" + String(item.line),
          "latextifier-nav-outline"
        );
        row.style.setProperty("--latextifier-outline-level", String(item.level));
      }
      return;
    }

    if (this.activeTab === "todos") {
      if (snapshot.todos.length === 0) return this.renderEmpty("No TODOs found.");
      for (const item of snapshot.todos) {
        this.addLocationRow(
          item,
          item.text,
          shortRelative(snapshot.root, item.file) + ":" + String(item.line),
          "latextifier-nav-todo"
        );
      }
      return;
    }

    if (this.activeTab === "files") {
      const files = [...snapshot.files, ...snapshot.bibFiles].sort();
      if (files.length === 0) return this.renderEmpty("No project files indexed.");
      for (const file of files) {
        this.addLocationRow(
          { file, line: 1, column: 0 },
          basename(file),
          shortRelative(snapshot.root, file),
          "latextifier-nav-file"
        );
      }
      return;
    }

    if (this.activeTab === "refs") {
      if (snapshot.labels.length === 0) return this.renderEmpty("No labels found.");
      for (const item of snapshot.labels) {
        this.addLocationRow(
          item,
          item.key,
          shortRelative(snapshot.root, item.file) + ":" + String(item.line),
          "latextifier-nav-ref"
        );
      }
      return;
    }

    if (snapshot.citations.length === 0) return this.renderEmpty("No citations found.");
    for (const item of snapshot.citations) {
      const detail = [item.author, item.year].filter(Boolean).join(" · ")
        || shortRelative(snapshot.root, item.file) + ":" + String(item.line);
      this.addLocationRow(
        item,
        item.title ? item.key + " — " + item.title : item.key,
        detail,
        "latextifier-nav-citation"
      );
    }
  }

  private addLocationRow(
    location: ProjectLocation,
    title: string,
    detail: string,
    className: string
  ): HTMLButtonElement {
    const button = this.bodyEl.createEl("button", {
      cls: "latextifier-navigator-row " + className,
      attr: { type: "button" }
    });
    button.createDiv({ cls: "latextifier-navigator-title", text: title });
    button.createDiv({ cls: "latextifier-navigator-detail", text: detail });
    button.addEventListener("click", () => this.callbacks.onOpen(location));
    return button;
  }

  private renderEmpty(message: string): void {
    this.bodyEl.empty();
    this.bodyEl.createDiv({ cls: "latextifier-navigator-empty", text: message });
  }

  private updateActiveTab(): void {
    for (const button of Array.from(this.tabsEl.querySelectorAll<HTMLButtonElement>(".latextifier-navigator-tab"))) {
      button.toggleClass("is-active", button.dataset.tab === this.activeTab);
    }
  }
}

function shortRelative(root: string, file: string): string {
  const value = relative(root.replace(/[\\/][^\\/]+$/, ""), file);
  return value || basename(file);
}
