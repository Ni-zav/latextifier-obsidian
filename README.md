# Latextifier

A local-first Obsidian LaTeX environment for both **ordinary Markdown notes** and **real multi-file TeX projects**.

Latextifier combines workflows that are normally split across separate tools:

- Markdown math stays instant through Obsidian/MathJax.
- Fenced LaTeX blocks can escalate to a real local TeX engine for TikZ, tables, packages, and layout constructs.
- .tex, .sty, and .cls files open in a project-aware source editor with live rendered math/theorems, persistent PDF preview, continuous SyncTeX, project navigation, TexLab, and compiler diagnostics.

## 0.2 highlights

### Markdown + full TeX blocks

Ordinary equations use the no-process MathJax path. A fenced latex or tex block can be forced through real TeX with the directive:

    % latextifier: tex
    \begin{tikzpicture}
      \draw (0,0) circle (1cm);
    \end{tikzpicture}

Full fragments are content-addressed, cached, compiled outside the vault, sanitized before insertion, and can resolve project/note-relative TeX inputs. If standalone.cls is unavailable, Latextifier falls back to an article wrapper.

### Real TeX project workspace

Open a .tex file for:

- project-aware CodeMirror source editing;
- viewport-scoped live math reading;
- rendered theorem/proof cards;
- compiled TikZ/table blocks in source;
- a persistent lazy PDF.js pane;
- last-known-good PDF on compiler failure;
- coalesced live builds instead of overlapping compiler processes;
- fast direct-engine builds plus full latexmk builds;
- pdfLaTeX, XeLaTeX, and LuaLaTeX;
- % !TEX root and % !TEX program directives;
- forward/inverse SyncTeX;
- **continuous source ↔ PDF scroll lock**;
- zoom and fit-width with reading-position preservation.

### Project intelligence

A shared per-root index provides structure, project files, bibliography files, TODO/FIXME discovery, whole-project search, labels, references, BibTeX citations, custom commands/environments, package hints, project preamble context, and a reference graph.

The index is shared across tabs and reuses unchanged files using mtime/size caching.

### Editing assistance

- project-wide ref/cite autofill;
- custom command/environment completion;
- package/environment/file completion;
- optional TexLab LSP completion, snippets, hover, and diagnostics;
- auto-close environments;
- list-item continuation;
- indentation preservation;
- bracket and dollar pairing;
- comment/uncomment;
- Tab/Shift-Tab indentation;
- symbol palette.

TexLab is an enhancement, not a hard dependency.

### Portable project export

**Export portable project HTML** creates one local, script-free HTML file beside the root containing the last successful PDF when available, project structure, TODOs, references/citations, and escaped source for every indexed TeX/BibTeX file. CSS is inline and the export makes no network requests.

## Requirements

- Obsidian 1.13+
- desktop Obsidian
- TeX Live, MacTeX, or MiKTeX
- at least one of pdflatex, xelatex, or lualatex
- recommended: latexmk
- recommended: synctex
- optional: dvisvgm
- optional: texlab

Latextifier never downloads or updates these tools.

## Commands

- Compile active TeX document
- Full build active TeX document
- Forward SyncTeX from cursor
- Toggle continuous source and PDF sync
- Toggle TeX PDF preview
- Toggle LaTeX project navigator
- Toggle live LaTeX reading
- Open LaTeX reference graph
- Open LaTeX symbol palette
- Export portable project HTML
- Insert LaTeX block

## Validation

The repository runs two CI tracks.

**Quality:** strict TypeScript, unit tests, Obsidian-focused lint, production bundle, and an installable plugin artifact.

**Real TeX integration:** CI installs a TeX toolchain and exercises pdfLaTeX, XeLaTeX, LuaLaTeX, multi-file dependencies, latexmk bibliography builds, and forward/inverse SyncTeX.

Large-project indexing and cache invalidation are covered by regression tests.

Manual Obsidian dogfooding is still required before a Community-directory release. See [Testing](docs/TESTING.md).

## Development

Clone or symlink the repository into a disposable vault at:

    <Vault>/.obsidian/plugins/latextifier

Then run:

    npm install --ignore-scripts
    npm run ci
    npm run dev

Tagged releases package main.js, manifest.json, styles.css, and a plugin zip automatically.

## Why not GPUI / wgpu?

Obsidian plugins run inside Electron and integrate through the DOM, CodeMirror, and workspace APIs. GPUI would require a separate native UI/process rather than a normal Obsidian pane, while wgpu would mean rebuilding PDF text layers, selection, links, and accessibility without removing TeX compilation as the dominant cost.

The architecture keeps parser/build boundaries narrow enough that Rust/WASM or a Rust sidecar can replace measured hotspots later. It is intentionally not added before profiling shows a real win.

See [ADR-001](docs/ADR-001-rust-gpui-wgpu.md).

## Security

- local/offline by default;
- no telemetry or remote compiler;
- no automatic dependency installation;
- child processes use argument arrays with shell disabled;
- TeX shell escape is disabled by default;
- generated SVG is sanitized before DOM insertion;
- build products live in the OS temp directory instead of polluting the vault.

## Competitive release gate

The dated engineering comparison with Texifier and LaTeX Live is in [docs/COMPETITOR-MATRIX.md](docs/COMPETITOR-MATRIX.md).

The target is a **stronger combined Obsidian workflow**: Markdown + full TeX projects + live reading + continuous SyncTeX + built-in project intelligence + optional TexLab + real-toolchain CI.

See [Architecture](docs/ARCHITECTURE.md) and [Testing](docs/TESTING.md).
