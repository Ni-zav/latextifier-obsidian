import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

const COMMANDS: Completion[] = [
  ["\\section{}", "Section"], ["\\subsection{}", "Subsection"], ["\\textbf{}", "Bold text"],
  ["\\emph{}", "Emphasis"], ["\\frac{}{}", "Fraction"], ["\\sqrt{}", "Square root"],
  ["\\label{}", "Label"], ["\\ref{}", "Reference"], ["\\eqref{}", "Equation reference"],
  ["\\cite{}", "Citation"], ["\\includegraphics{}", "Graphic"], ["\\input{}", "Input file"],
  ["\\begin{}\\n\\n\\end{}", "Environment"]
].map(([apply, detail]) => ({ label: apply ?? "", apply: apply ?? "", detail, type: "keyword" }));

const ENVIRONMENTS = [
  "document", "equation", "equation*", "align", "align*", "gather", "multline",
  "itemize", "enumerate", "description", "figure", "table", "tabular",
  "theorem", "lemma", "proof", "tikzpicture"
];

export const latexCompletionSource: CompletionSource = (
  context: CompletionContext
): CompletionResult | null => {
  const environment = context.matchBefore(/\\(?:begin|end)\{[^}\n]*$/);
  if (environment) {
    const brace = environment.text.lastIndexOf("{");
    return {
      from: environment.from + brace + 1,
      options: ENVIRONMENTS.map((label) => ({ label, type: "class" })),
      validFor: /^[^}\n]*$/
    };
  }

  const command = context.matchBefore(/\\[A-Za-z@]*$/);
  if (!command || (command.from === command.to && !context.explicit)) return null;

  const labels = collectLabels(context.state.doc.toString());
  const dynamic: Completion[] = labels.map((label) => ({
    label: "\\ref{" + label + "}",
    apply: "\\ref{" + label + "}",
    detail: "Local label",
    type: "variable"
  }));

  return {
    from: command.from,
    options: [...COMMANDS, ...dynamic],
    validFor: /^\\[A-Za-z@]*$/
  };
};

function collectLabels(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(/\\label\{([^}]+)\}/g)) {
    if (match[1]) values.add(match[1]);
    if (values.size >= 80) break;
  }
  return [...values];
}
