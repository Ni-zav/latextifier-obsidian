import type { Diagnostic } from "../types";

export function parseLatexLog(raw: string, rootDir = ""): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const fileLine = /^(.*?\.tex):(\d+):\s*(.+)$/.exec(line);
    if (fileLine) {
      pushUnique(diagnostics, seen, {
        severity: severityFor(fileLine[3] ?? ""),
        file: normalizeFile(fileLine[1] ?? "", rootDir),
        line: Number(fileLine[2]),
        message: (fileLine[3] ?? "").trim()
      });
      continue;
    }

    if (line.startsWith("! ")) {
      let sourceLine: number | undefined;
      const next = lines[index + 1] ?? "";
      const match = /^l\.(\d+)\s/.exec(next);
      if (match) sourceLine = Number(match[1]);
      pushUnique(diagnostics, seen, {
        severity: "error",
        line: sourceLine,
        message: line.slice(2).trim()
      });
      continue;
    }

    if (/^(LaTeX|Package .*?) Warning:/.test(line)) {
      const lineMatch = /on input line (\d+)/.exec(line);
      pushUnique(diagnostics, seen, {
        severity: "warning",
        line: lineMatch ? Number(lineMatch[1]) : undefined,
        message: line.trim()
      });
    }
  }

  return diagnostics;
}

export function logRequestsRerun(raw: string): boolean {
  return /Rerun to get cross-references right|Label\(s\) may have changed|rerunfilecheck Warning/.test(raw);
}

function severityFor(message: string): Diagnostic["severity"] {
  if (/\bwarning\b/i.test(message)) return "warning";
  if (/\berror\b|undefined control sequence|emergency stop/i.test(message)) return "error";
  return "error";
}

function normalizeFile(file: string, rootDir: string): string {
  if (!rootDir || file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)) return file;
  return rootDir.replace(/[\\/]$/, "") + "/" + file;
}

function pushUnique(items: Diagnostic[], seen: Set<string>, item: Diagnostic): void {
  const key = [item.severity, item.file ?? "", item.line ?? "", item.message].join("|");
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}
