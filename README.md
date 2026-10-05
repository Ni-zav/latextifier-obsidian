# Latextifier

One Obsidian plugin for **fast LaTeX inside Markdown** and **real TeX projects with live PDF preview**.

Latextifier has two rendering lanes:

- **Markdown lane:** ordinary math stays on Obsidian's MathJax path; fenced `latex` / `tex` blocks can escalate to a local TeX compiler for packages, TikZ, tables, or document-level layout.
- **Project lane:** `.tex`, `.sty`, and `.cls` files open in a dedicated editor with coalesced live compilation, a persistent PDF.js preview, diagnostics, project-root resolution, and SyncTeX navigation.

## Status

This is a 0.1.x developer release. The implementation is designed for production behavior but should still be exercised against real vaults and TeX distributions before Community directory submission.

## Requirements

- Obsidian 1.13+
- desktop Obsidian
- TeX Live, MacTeX, or MiKTeX
- `pdflatex`, `xelatex`, or `lualatex`
- recommended: `latexmk`
- recommended: `synctex`
- optional: `dvisvgm` for crisp SVG full-block output

Latextifier never installs or updates external tools.

## Markdown

Obsidian's normal `$$ ... $$` math keeps using MathJax.

Latextifier adds fenced blocks:

````md
```latex
\begin{align}
E &= mc^2 \\
F &= ma
\end{align}
```
````

Force a real TeX compile:

````md
```latex
% latextifier: tex
\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}
```
````

Force the fast MathJax path with `% latextifier: math`.

## TeX projects

Open a `.tex` file for:

- source + PDF in one view;
- debounced live compile;
- one compiler per resolved project root;
- coalesced rebuilds during rapid typing;
- direct-engine fast builds and explicit `latexmk` full builds;
- `% !TEX root = ../main.tex`;
- `% !TEX program = xelatex`;
- last-known-good PDF on failure;
- diagnostics and jump-to-error;
- forward and inverse SyncTeX;
- zoom, fit width, and preserved PDF reading position.

## Commands

- Compile active TeX document
- Full build active TeX document
- Forward SyncTeX from cursor
- Toggle TeX PDF preview
- Insert LaTeX block

## Build

```bash
npm install --ignore-scripts
npm run ci
```

For development, clone/symlink this repo to `<Vault>/.obsidian/plugins/latextifier` in a dedicated test vault and run `npm run dev`.

## Rust / GPUI / wgpu

The in-app UI deliberately uses Obsidian's TypeScript APIs, CodeMirror, and bundled PDF.js. GPUI/wgpu would require a second native UI/process and would lose native PDF text/accessibility behavior without removing TeX compilation as the dominant cost.

Rust remains an option for measured parser/daemon hotspots. See [ADR-001](docs/ADR-001-rust-gpui-wgpu.md).

## Security

Latextifier is local-first: no telemetry, remote compiler, or automatic dependency installation. Child processes use argument arrays with `shell: false`, and shell escape is disabled by default.

See [Architecture](docs/ARCHITECTURE.md).
