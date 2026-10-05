import { StateEffect, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from "@codemirror/view";
import { finishRenderMath, renderMath } from "obsidian";
import type { ProjectSnapshot } from "../core/project-index";

export const refreshLiveLatexEffect = StateEffect.define<void>();

export function liveLatexReadingExtension(
  enabled: () => boolean,
  getSnapshot: () => ProjectSnapshot | null
): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view, enabled(), getSnapshot());
    }

    update(update: ViewUpdate): void {
      const refresh = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshLiveLatexEffect))
      );
      if (refresh || update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = build(update.view, enabled(), getSnapshot());
      }
    }
  }, {
    decorations: (value) => value.decorations
  });
}

class MathWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly display: boolean
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return this.source === other.source && this.display === other.display;
  }

  toDOM(): HTMLElement {
    const container = document.createElement(this.display ? "div" : "span");
    container.className = this.display
      ? "latextifier-live-math latextifier-live-math-display"
      : "latextifier-live-math latextifier-live-math-inline";
    try {
      container.appendChild(renderMath(this.source, this.display));
      void finishRenderMath();
    } catch {
      container.textContent = this.source;
      container.classList.add("is-fallback");
    }
    return container;
  }
}

class ReferenceWidget extends WidgetType {
  constructor(
    private readonly kind: "ref" | "cite",
    private readonly key: string,
    private readonly detail: string
  ) {
    super();
  }

  eq(other: ReferenceWidget): boolean {
    return this.kind === other.kind && this.key === other.key && this.detail === other.detail;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "latextifier-live-reference latextifier-live-reference-" + this.kind;
    chip.textContent = this.kind === "cite" ? "@" + this.key : "↗ " + this.key;
    if (this.detail) chip.title = this.detail;
    return chip;
  }
}

interface Candidate {
  from: number;
  to: number;
  decoration: Decoration;
}

function build(
  view: EditorView,
  enabled: boolean,
  snapshot: ProjectSnapshot | null
): DecorationSet {
  if (!enabled) return Decoration.none;
  const candidates: Candidate[] = [];

  for (const visible of view.visibleRanges) {
    const startLine = view.state.doc.lineAt(visible.from);
    const endLine = view.state.doc.lineAt(visible.to);
    const from = Math.max(0, view.state.doc.line(Math.max(1, startLine.number - 18)).from);
    const to = view.state.doc.line(Math.min(view.state.doc.lines, endLine.number + 18)).to;
    const text = view.state.sliceDoc(from, to);

    collectDisplayMath(text, from, candidates);
    collectInlineMath(text, from, candidates);
    collectReferences(text, from, snapshot, candidates);
  }

  const selections = view.state.selection.ranges;
  const filtered = candidates
    .filter((candidate) => !selections.some((range) => intersects(range.from, range.to, candidate.from, candidate.to)))
    .sort((a, b) => a.from - b.from || b.to - a.to);

  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  const seen = new Set<string>();
  for (const candidate of filtered) {
    const key = String(candidate.from) + ":" + String(candidate.to);
    if (seen.has(key) || candidate.from < lastTo) continue;
    seen.add(key);
    builder.add(candidate.from, candidate.to, candidate.decoration);
    lastTo = candidate.to;
  }
  return builder.finish();
}

function collectDisplayMath(text: string, offset: number, result: Candidate[]): void {
  const patterns: Array<{ regex: RegExp; source: (match: RegExpExecArray) => string }> = [
    {
      regex: /\$\$([\s\S]*?)\$\$/g,
      source: (match) => match[1] ?? ""
    },
    {
      regex: /\\\[([\s\S]*?)\\\]/g,
      source: (match) => match[1] ?? ""
    },
    {
      regex: /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|alignat\*?)\}([\s\S]*?)\\end\{\1\}/g,
      source: (match) => "\\begin{" + (match[1] ?? "equation") + "}" + (match[2] ?? "") + "\\end{" + (match[1] ?? "equation") + "}"
    }
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const from = offset + (match.index ?? 0);
      const to = from + match[0].length;
      result.push({
        from,
        to,
        decoration: Decoration.replace({
          block: true,
          widget: new MathWidget(pattern.source(match), true)
        })
      });
    }
  }
}

function collectInlineMath(text: string, offset: number, result: Candidate[]): void {
  const regex = /(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const from = offset + (match.index ?? 0);
    const to = from + match[0].length;
    result.push({
      from,
      to,
      decoration: Decoration.replace({
        widget: new MathWidget(match[1] ?? "", false)
      })
    });
  }
}

function collectReferences(
  text: string,
  offset: number,
  snapshot: ProjectSnapshot | null,
  result: Candidate[]
): void {
  const regex = /\\(ref|eqref|autoref|cref|Cref|cite|parencite|textcite)\*?\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const command = match[1] ?? "";
    const key = (match[2] ?? "").split(",")[0]?.trim() ?? "";
    if (!key) continue;
    const cite = /cite/i.test(command);
    const detail = cite
      ? citationDetail(snapshot, key)
      : labelDetail(snapshot, key);
    const from = offset + (match.index ?? 0);
    const to = from + match[0].length;
    result.push({
      from,
      to,
      decoration: Decoration.replace({
        widget: new ReferenceWidget(cite ? "cite" : "ref", key, detail)
      })
    });
  }
}

function citationDetail(snapshot: ProjectSnapshot | null, key: string): string {
  const item = snapshot?.citations.find((candidate) => candidate.key === key);
  if (!item) return key;
  return [item.author, item.year, item.title].filter(Boolean).join(" · ");
}

function labelDetail(snapshot: ProjectSnapshot | null, key: string): string {
  const item = snapshot?.labels.find((candidate) => candidate.key === key);
  if (!item) return key;
  const file = item.file.replaceAll("\\", "/");
  return file.slice(file.lastIndexOf("/") + 1) + ":" + String(item.line);
}

function intersects(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom <= bTo && aTo >= bFrom;
}
