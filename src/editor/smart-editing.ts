import type { ChangeSpec, Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type { LatextifierSettings } from "../types";

export function smartEditingExtension(settings: () => LatextifierSettings): Extension {
  return keymap.of([
    {
      key: "Enter",
      run: (view) => handleEnter(view, settings())
    },
    {
      key: "$",
      run: handleDollar
    },
    {
      key: "Mod-/",
      run: toggleComment
    }
  ]);
}

function handleEnter(view: EditorView, settings: LatextifierSettings): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const before = line.text.slice(0, selection.head - line.from);
  const after = line.text.slice(selection.head - line.from);
  const indent = /^\s*/.exec(line.text)?.[0] ?? "";

  const begin = /\\begin\{([^}]+)\}\s*$/.exec(before);
  if (begin && settings.autoCloseEnvironment) {
    const environment = begin[1] ?? "";
    const rest = view.state.sliceDoc(selection.head, Math.min(view.state.doc.length, selection.head + 4000));
    if (!rest.includes("\\end{" + environment + "}")) {
      const inner = indent + "  ";
      const insert = "\n" + inner + "\n" + indent + "\\end{" + environment + "}";
      view.dispatch({
        changes: { from: selection.head, to: selection.head, insert },
        selection: { anchor: selection.head + 1 + inner.length }
      });
      return true;
    }
  }

  if (settings.autoContinueItems && /^\s*\\item(?:\[[^\]]*\])?\b/.test(line.text)) {
    const insert = "\n" + indent + "\\item ";
    view.dispatch({
      changes: { from: selection.head, to: selection.head, insert },
      selection: { anchor: selection.head + insert.length }
    });
    return true;
  }

  if (/^\s*$/.test(after)) {
    const insert = "\n" + indent;
    view.dispatch({
      changes: { from: selection.head, to: selection.head, insert },
      selection: { anchor: selection.head + insert.length }
    });
    return true;
  }

  return false;
}

function handleDollar(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    const selected = view.state.sliceDoc(selection.from, selection.to);
    const multiline = selected.includes("\n");
    const open = multiline ? "$$\n" : "$";
    const close = multiline ? "\n$$" : "$";
    const insert = open + selected + close;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: {
        anchor: selection.from + open.length,
        head: selection.from + open.length + selected.length
      }
    });
    return true;
  }

  const next = view.state.sliceDoc(selection.head, selection.head + 1);
  if (next === "$") {
    view.dispatch({ selection: { anchor: selection.head + 1 } });
    return true;
  }

  view.dispatch({
    changes: { from: selection.head, insert: "$$" },
    selection: { anchor: selection.head + 1 }
  });
  return true;
}

function toggleComment(view: EditorView): boolean {
  const ranges = view.state.selection.ranges;
  const lineNumbers = new Set<number>();
  for (const range of ranges) {
    const start = view.state.doc.lineAt(range.from).number;
    const endPosition = range.to > range.from ? Math.max(range.from, range.to - 1) : range.to;
    const end = view.state.doc.lineAt(endPosition).number;
    for (let line = start; line <= end; line += 1) lineNumbers.add(line);
  }

  const lines = [...lineNumbers].sort((a, b) => a - b).map((number) => view.state.doc.line(number));
  if (lines.length === 0) return false;
  const uncomment = lines.every((line) => /^\s*%/.test(line.text));
  const changes: ChangeSpec[] = [];

  for (const line of lines) {
    if (uncomment) {
      const match = /^(\s*)%\s?/.exec(line.text);
      if (!match) continue;
      const prefix = match[0];
      const indent = match[1] ?? "";
      changes.push({ from: line.from, to: line.from + prefix.length, insert: indent });
    } else {
      const indent = /^\s*/.exec(line.text)?.[0] ?? "";
      changes.push({ from: line.from + indent.length, insert: "% " });
    }
  }

  view.dispatch({ changes });
  return true;
}
