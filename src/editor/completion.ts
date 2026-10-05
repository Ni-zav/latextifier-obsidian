import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { ProjectSnapshot } from "../core/project-index";

const BASE_COMMANDS: Completion[] = [
  ["\\section{}", "Section"],
  ["\\subsection{}", "Subsection"],
  ["\\subsubsection{}", "Subsubsection"],
  ["\\textbf{}", "Bold text"],
  ["\\textit{}", "Italic text"],
  ["\\emph{}", "Emphasis"],
  ["\\frac{}{}", "Fraction"],
  ["\\sqrt{}", "Square root"],
  ["\\label{}", "Label"],
  ["\\ref{}", "Reference"],
  ["\\eqref{}", "Equation reference"],
  ["\\autoref{}", "Automatic reference"],
  ["\\cref{}", "Clever reference"],
  ["\\cite{}", "Citation"],
  ["\\parencite{}", "Parenthetical citation"],
  ["\\textcite{}", "Text citation"],
  ["\\includegraphics{}", "Graphic"],
  ["\\input{}", "Input file"],
  ["\\include{}", "Include file"],
  ["\\usepackage{}", "Package"],
  ["\\begin{}", "Environment"]
].map(([apply, detail]) => ({
  label: apply ?? "",
  apply: apply ?? "",
  detail,
  type: "keyword"
}));

const BASE_ENVIRONMENTS = [
  "document", "equation", "equation*", "align", "align*", "gather", "gather*",
  "multline", "itemize", "enumerate", "description", "figure", "figure*",
  "table", "table*", "tabular", "tabularx", "theorem", "lemma", "proposition",
  "corollary", "definition", "proof", "quote", "quotation", "verbatim",
  "lstlisting", "minted", "tikzpicture"
];

const COMMON_PACKAGES = [
  "amsmath", "amssymb", "mathtools", "graphicx", "xcolor", "hyperref",
  "cleveref", "booktabs", "tabularx", "array", "geometry", "microtype",
  "fontspec", "unicode-math", "biblatex", "natbib", "tikz", "pgfplots",
  "listings", "minted", "siunitx", "physics", "enumitem", "fancyhdr"
];

export function createLatexCompletionSource(
  getSnapshot: () => ProjectSnapshot | null,
  autoCloseEnvironment: () => boolean
): CompletionSource {
  return (context) => completeLatex(context, getSnapshot(), autoCloseEnvironment());
}

function completeLatex(
  context: CompletionContext,
  snapshot: ProjectSnapshot | null,
  autoCloseEnvironment: boolean
): CompletionResult | null {
  const text = context.state.sliceDoc(0, context.pos);

  const reference = context.matchBefore(/\\(?:ref|eqref|autoref|cref|Cref|pageref)\{[^}\n]*$/);
  if (reference) {
    const from = reference.from + reference.text.lastIndexOf("{") + 1;
    return {
      from,
      options: (snapshot?.labels ?? []).map((item) => ({
        label: item.key,
        detail: shortFile(item.file) + ":" + String(item.line),
        type: "variable"
      })),
      validFor: /^[^}\n]*$/
    };
  }

  const citation = context.matchBefore(/\\(?:cite|parencite|textcite|autocite|footcite|citep|citet)\*?(?:\[[^\]]*\])?\{[^}\n]*$/);
  if (citation) {
    const from = citation.from + citation.text.lastIndexOf("{") + 1;
    return {
      from,
      options: (snapshot?.citations ?? []).map((item) => ({
        label: item.key,
        detail: [item.author, item.year].filter(Boolean).join(" · ") || item.kind || "Citation",
        info: item.title,
        type: "variable"
      })),
      validFor: /^[^}\n,]*$/
    };
  }

  const environment = context.matchBefore(/\\(begin|end)\{[^}\n]*$/);
  if (environment) {
    const begin = environment.text.startsWith("\\begin");
    const brace = environment.text.lastIndexOf("{");
    const names = unique([
      ...BASE_ENVIRONMENTS,
      ...(snapshot?.environments ?? []).map((item) => item.name)
    ]);
    return {
      from: environment.from + brace + 1,
      options: names.map((name) => ({
        label: name,
        detail: snapshot?.environments.some((item) => item.name === name) ? "Project environment" : "Environment",
        type: "class",
        apply: begin && autoCloseEnvironment ? environmentApply(name) : name
      })),
      validFor: /^[^}\n]*$/
    };
  }

  const packageMatch = context.matchBefore(/\\usepackage(?:\[[^\]]*\])?\{[^}\n,]*$/);
  if (packageMatch) {
    const from = Math.max(packageMatch.from, packageMatch.from + packageMatch.text.lastIndexOf("{") + 1);
    return {
      from,
      options: unique([...COMMON_PACKAGES, ...(snapshot?.packages ?? [])]).map((name) => ({
        label: name,
        detail: snapshot?.packages.includes(name) ? "Used in project" : "Package",
        type: "namespace"
      })),
      validFor: /^[^}\n,]*$/
    };
  }

  const input = context.matchBefore(/\\(?:input|include|subfile)\{[^}\n]*$/);
  if (input) {
    const from = input.from + input.text.lastIndexOf("{") + 1;
    return {
      from,
      options: (snapshot?.files ?? [])
        .filter((file) => file !== snapshot?.root)
        .map((file) => ({
          label: relativeProjectPath(snapshot?.root ?? "", file),
          detail: "Project file",
          type: "text"
        })),
      validFor: /^[^}\n]*$/
    };
  }

  const command = context.matchBefore(/\\[A-Za-z@]*$/);
  if (!command || (command.from === command.to && !context.explicit)) return null;

  const projectCommands: Completion[] = (snapshot?.commands ?? []).map((item) => ({
    label: "\\" + item.name,
    apply: "\\" + item.name + "{}".repeat(item.arguments),
    detail: item.arguments > 0 ? "Project command · " + String(item.arguments) + " args" : "Project command",
    type: "function"
  }));

  const currentCommand = /\\([A-Za-z@]*)$/.exec(text)?.[1] ?? "";
  return {
    from: command.from,
    options: [...BASE_COMMANDS, ...projectCommands],
    filter: currentCommand.length > 0,
    validFor: /^\\[A-Za-z@]*$/
  };
}

function environmentApply(name: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number): void => {
    const suffix = "}\n\n\\end{" + name + "}";
    const insert = name + suffix;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + name.length + 2 }
    });
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function shortFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function relativeProjectPath(root: string, file: string): string {
  if (!root) return shortFile(file).replace(/\.tex$/i, "");
  const rootDir = root.replaceAll("\\", "/").replace(/\/[^/]+$/, "");
  const normalized = file.replaceAll("\\", "/");
  const relative = normalized.startsWith(rootDir + "/") ? normalized.slice(rootDir.length + 1) : shortFile(file);
  return relative.replace(/\.tex$/i, "");
}
