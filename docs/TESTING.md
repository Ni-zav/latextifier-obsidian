# Validation guide

## Automated

Run:

    npm install --ignore-scripts
    npm run ci

The unit suite covers:

- Markdown fragment classification and directives;
- TeX project/root metadata parsing;
- engine detection;
- compiler log parsing and rerun detection;
- SyncTeX forward/inverse output parsing;
- valid TeX fragment wrapping.

GitHub Actions repeats typecheck, tests, lint, and production bundling.

## Manual Obsidian acceptance

Use a disposable vault. Install a local TeX distribution before testing.

### Markdown

1. Open a Markdown note in Live Preview.
2. Add a fenced latex block containing a fraction or align environment.
3. Confirm the fast MathJax path renders without starting a TeX process.
4. Put the cursor inside the source block and confirm raw source becomes editable.
5. Add a TikZ block with `% latextifier: tex`.
6. Confirm it renders and remains stable after switching notes.
7. Test Reading view and Live Preview with the same block.

### TeX project

1. Open a single-file article and verify the split source/PDF workspace.
2. Type rapidly for several seconds; verify builds coalesce rather than overlap.
3. Introduce a compiler error; verify the previous successful PDF remains visible.
4. Fix it and verify the PDF refreshes without jumping to page 1.
5. Test zoom and fit-width across rebuilds.
6. Test a multi-file project using `% !TEX root = ../main.tex`.
7. Verify cursor -> PDF forward SyncTeX.
8. Double-click the PDF and verify inverse SyncTeX opens/focuses the source line.
9. Test pdfLaTeX, XeLaTeX, and LuaLaTeX projects.
10. Run a full build with bibliography references.

### Security

1. Confirm shell escape is off by default.
2. Confirm no build artifacts appear in the vault.
3. Confirm no network request or telemetry is emitted by Latextifier.
4. Confirm missing tools produce actionable errors rather than automatic downloads.

## Performance acceptance

Measure on a representative long project:

- plugin startup should spawn zero TeX processes;
- edits during an active build should produce at most one queued follow-up build;
- only nearby PDF pages should have canvases/text layers;
- ordinary Markdown math should never hit the full TeX fragment compiler;
- repeated identical full-LaTeX Markdown blocks should reuse the in-process cache.
