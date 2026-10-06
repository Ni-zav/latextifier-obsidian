import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import type { MarkdownLatexRenderer } from "./renderer";

const FENCE_RE = /^ {0,3}\x60\x60\x60(?:latex|tex)\s*\n([\s\S]*?)^ {0,3}\x60\x60\x60[ \t]*$/gm;

export function latexBlockLivePreview(renderer: MarkdownLatexRenderer): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, renderer);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view, renderer);
      }
    }
  }, {
    decorations: (value) => value.decorations
  });
}

class LatexBlockWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
    private readonly renderer: MarkdownLatexRenderer
  ) {
    super();
  }

  eq(other: LatexBlockWidget): boolean {
    return this.source === other.source && this.from === other.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = view.dom.ownerDocument.createElement("div");
    container.className = "latextifier-live-block";
    container.addEventListener("mousedown", (event: MouseEvent) => {
      if (event.button !== 0) return;
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    void this.renderer.render(this.source, container);
    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(view: EditorView, renderer: MarkdownLatexRenderer): DecorationSet {
  if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;

  const text = view.state.doc.toString();
  const selections = view.state.selection.ranges;
  const builder = new RangeSetBuilder<Decoration>();
  FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (!touchesViewport(view, from, to)) continue;
    if (selections.some((selection) => selection.head >= from && selection.head <= to)) continue;

    builder.add(
      from,
      to,
      Decoration.replace({
        block: true,
        widget: new LatexBlockWidget(match[1] ?? "", from, renderer)
      })
    );
  }

  return builder.finish();
}

function touchesViewport(view: EditorView, from: number, to: number): boolean {
  return view.visibleRanges.some((range) => to >= range.from && from <= range.to);
}
