import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const commandMark = Decoration.mark({ class: "ltx-syntax-command" });
const commentMark = Decoration.mark({ class: "ltx-syntax-comment" });
const mathMark = Decoration.mark({ class: "ltx-syntax-math" });

export function latexHighlightExtension(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  }, {
    decorations: (value) => value.decorations
  });
}

function build(view: EditorView): DecorationSet {
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  const seen = new Set<string>();

  for (const visible of view.visibleRanges) {
    let position = view.state.doc.lineAt(visible.from).from;
    while (position <= visible.to) {
      const line = view.state.doc.lineAt(position);
      const text = line.text;
      const commentAt = firstUnescapedPercent(text);
      const code = commentAt >= 0 ? text.slice(0, commentAt) : text;

      for (const match of code.matchAll(/\\(?:[A-Za-z@]+|.)/g)) {
        const start = line.from + (match.index ?? 0);
        add(ranges, seen, start, start + match[0].length, commandMark);
      }
      for (const match of code.matchAll(/\${1,2}/g)) {
        const start = line.from + (match.index ?? 0);
        add(ranges, seen, start, start + match[0].length, mathMark);
      }
      if (commentAt >= 0) add(ranges, seen, line.from + commentAt, line.to, commentMark);

      if (line.to >= visible.to || line.number >= view.state.doc.lines) break;
      position = line.to + 1;
    }
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.decoration);
  return builder.finish();
}

function add(
  ranges: Array<{ from: number; to: number; decoration: Decoration }>,
  seen: Set<string>,
  from: number,
  to: number,
  decoration: Decoration
): void {
  if (to <= from) return;
  const key = String(from) + ":" + String(to);
  if (seen.has(key)) return;
  seen.add(key);
  ranges.push({ from, to, decoration });
}

function firstUnescapedPercent(text: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "%") continue;
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
    if (slashes % 2 === 0) return index;
  }
  return -1;
}
