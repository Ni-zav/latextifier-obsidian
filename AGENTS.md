# Repository instructions

Latextifier is an Obsidian desktop plugin for two related workflows:

1. fast LaTeX rendering inside normal Markdown notes;
2. full .tex project editing with live PDF preview and SyncTeX.

## Engineering rules

- Keep plugin startup cheap. Do not spawn TeX, scan projects, or load PDF.js in `onload()`.
- Use public Obsidian APIs where available.
- Use argument-array child processes with `shell: false`; shell escape is disabled by default.
- Never download or install TeX tools from the plugin.
- Preserve the last successful PDF when a build fails.
- Coalesce build requests; never run concurrent builds for the same root.
- Prefer viewport/lazy PDF rendering.
- Keep Markdown math on the MathJax fast path whenever a TeX process is unnecessary.
- Treat full LaTeX blocks as trusted local code. Do not enable `--shell-escape` by default.
- Tests should cover parsers, root discovery helpers, build coalescing, log parsing, and SyncTeX parsing.
- Do not commit generated `main.js`, caches, TeX build outputs, tokens, or vault content.

## Architecture

See `docs/ARCHITECTURE.md` and the ADRs in `docs/`.
