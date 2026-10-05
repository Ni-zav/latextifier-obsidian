import type { Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type { LatextifierSettings } from "../types";

export function smartEditingExtension(settings: () => LatextifierSettings): Extension {
  return keymap.of([{
    key: "Enter",
    run: (view) => handleEnter(view, settings())
  }]);
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
