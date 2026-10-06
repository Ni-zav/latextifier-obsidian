import {
  snippet,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from "@codemirror/autocomplete";
import type { TexlabClient } from "../core/texlab";

export function createTexlabCompletionSource(
  getClient: () => TexlabClient | null,
  getFile: () => string | null
): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const client = getClient();
    const file = getFile();
    if (!client || !file) return null;

    const token = completionToken(context);
    if (!token && !context.explicit) return null;

    const line = context.state.doc.lineAt(context.pos);
    try {
      const items = await client.completion(file, line.number, context.pos - line.from);
      if (items.length === 0) return null;
      return {
        from: token?.from ?? context.pos,
        options: items.map((item) => ({
          label: item.label,
          apply: item.insertTextFormat === 2
            ? snippet(normalizeLspSnippet(item.insertText ?? item.label))
            : item.insertText ?? item.label,
          detail: item.detail,
          type: "function",
          boost: item.sortText ? 1 : undefined
        }))
      };
    } catch {
      return null;
    }
  };
}

function completionToken(context: CompletionContext): { from: number } | null {
  const command = context.matchBefore(/\\[A-Za-z@]*$/);
  if (command) return { from: command.from };

  const argument = context.matchBefore(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?\{[^}\n]*$/);
  if (argument) {
    const comma = argument.text.lastIndexOf(",");
    const brace = argument.text.lastIndexOf("{");
    return { from: argument.from + Math.max(comma, brace) + 1 };
  }

  return null;
}


function normalizeLspSnippet(value: string): string {
  return value
    .replace(/\$\{(\d+):([^}]*)\}/g, (_match, index: string, placeholder: string) => "${" + index + ":" + placeholder + "}")
    .replace(/\$(\d+)/g, (_match, index: string) => "${" + index + "}");
}
