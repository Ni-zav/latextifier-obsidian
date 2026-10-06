# Architecture

## Product contract

Latextifier has two rendering lanes that share project/build infrastructure without forcing TeX-process latency onto ordinary Markdown math.

### Markdown lane

A fenced latex/tex block is classified as:

- **math** — render with Obsidian MathJax;
- **tex** — run the local TeX fragment compiler and prefer sanitized SVG output;
- **auto** — use MathJax unless packages, TikZ, tables, graphics, or document-level constructs require TeX.

Full fragments are content-addressed and cached. They may receive note/project context so relative includes and project macros resolve naturally. Build products live under the OS temp directory.

### Project lane

Real TeX files use a dedicated TextFileView:

    +----------------+-------------------------+----------------------+
    | project index  | CodeMirror source       | persistent PDF.js    |
    | outline        | live math/theorems      | lazy page renderer   |
    | files/TODOs    | TexLab + built-in intel | text layer           |
    | refs/cites     | compiler diagnostics    | SyncTeX              |
    +----------------+-------------------------+----------------------+

A session belongs to the resolved root document, not an editor tab. Included chapters share:

- one compiler queue;
- one last-known-good PDF;
- one project index;
- one TexLab process;
- one dependency set;
- one reference graph.

## Project intelligence

The built-in ProjectIndex recursively follows input/include/subfile and bibliography resources. It extracts:

- structure;
- files;
- packages;
- labels;
- citation metadata;
- custom commands and environments;
- reference edges;
- TODO/FIXME markers;
- reusable project preamble.

Unchanged files are reused through mtime/size-backed caching. The built-in index remains useful when TexLab is absent; TexLab augments completion, snippets, hover, and diagnostics.

## Continuous synchronization

SyncTeX is used for:

- explicit source → PDF jumps;
- PDF → source jumps;
- debounced source-scroll → PDF mapping;
- debounced PDF-scroll → source mapping.

A short reentrancy guard prevents source → PDF → source feedback loops. PDF programmatic movement preserves focus.

## PDF rendering

The PDF renderer is persistent across successful builds. It:

- keeps scroll/page/zoom anchors;
- renders only nearby pages;
- limits retained canvases;
- uses device-pixel-ratio-aware canvas backing sizes;
- retains selectable PDF.js text layers;
- flashes forward-SyncTeX locations.

Failed builds never replace the last successful PDF.

## Compilation

### Project builds

- fast mode runs the selected engine directly;
- full mode uses latexmk when available;
- at most one compiler process is active per project;
- edits during compilation collapse into one newest follow-up build;
- shell interpolation is never used;
- shell escape is off unless explicitly enabled.

### Fragment builds

- ordinary math never spawns TeX;
- full fragments compile in a content-addressed temp directory;
- project/note context can be exposed via working directory and TEXINPUTS;
- standalone.cls is preferred for tight output;
- article is an automatic fallback;
- dvisvgm SVG is preferred when available;
- PDF canvas rendering is the fallback.

## Live source reading

Only visible source plus a bounded margin is transformed. When the cursor intersects a rendered construct, its original source remains editable.

Supported live constructs include:

- inline/display math;
- equation/align/gather families;
- theorem/lemma/proposition/corollary/definition/remark/example/proof cards;
- reference/citation chips;
- compiled TikZ and table blocks.

This avoids reparsing/rendering an entire thesis on every keystroke.

## Portable export

Portable project HTML is generated locally with:

- inline CSS;
- escaped source;
- project metadata;
- references/citations/TODOs;
- the last successful PDF as a data URI when available;
- zero JavaScript and zero network dependencies.

## Validation architecture

Quality CI covers TypeScript, unit tests, lint, production bundling, and an installable artifact.

A separate integration job installs a real TeX toolchain and exercises pdfLaTeX, XeLaTeX, LuaLaTeX, latexmk bibliography, multi-file dependencies, and SyncTeX round trips.

## Security boundaries

TeX is executable document-processing software. Defaults are deliberately conservative:

- local-only operation;
- no telemetry;
- no remote compiler;
- no automatic tool/package downloads;
- child_process uses argument arrays with shell disabled;
- TeX shell escape disabled by default;
- generated SVG sanitized before insertion.

## Rust boundary

Rust, GPUI, and wgpu were evaluated explicitly. GPUI/wgpu do not map cleanly onto an Obsidian WorkspaceLeaf and would replace useful browser/PDF.js accessibility behavior without removing TeX compilation as the dominant cost.

The parser/build boundaries stay narrow so Rust/WASM or a Rust sidecar can be introduced later for measured hotspots such as very large structural parsing or a persistent compiler daemon.

See ADR-001.
