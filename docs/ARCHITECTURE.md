# Architecture

## Product contract

Latextifier serves two workflows without forcing one rendering pipeline onto both.

### Markdown lane

For ordinary equations, spawning TeX would be a performance regression. The Markdown renderer classifies each fenced `latex`/`tex` block:

- **math:** render with Obsidian's MathJax API;
- **tex:** compile a wrapped fragment locally and prefer sanitized SVG output;
- **auto:** choose math unless the source contains document/package/TikZ/table/layout constructs.

The same renderer is used in Reading view and Live Preview. Full-fragment results are content-addressed and deduplicated.

### Project lane

Real TeX files use a dedicated `TextFileView`:

```text
+--------------------------+--------------------------+
| CodeMirror source        | persistent PDF.js view   |
|                          |                          |
| save -> debounce --------+-> project session        |
| cursor -> SyncTeX -------+-> PDF highlight          |
| source focus <-----------+-- PDF double click       |
+--------------------------+--------------------------+
```

A session belongs to the resolved root document, not to an editor tab. Included chapters therefore share one compiler and one last-good PDF.

## Performance principles

1. No TeX process or PDF.js load during plugin startup.
2. Direct-engine builds for feedback; `latexmk` for explicit full builds.
3. One build at a time per root; requests arriving while busy collapse into one newest follow-up build.
4. The PDF view keeps its DOM and reading position across reloads.
5. PDF pages render lazily around the viewport.
6. Canvas resolution follows device pixel ratio while CSS size stays stable.
7. Math-only Markdown blocks never touch the filesystem.
8. Full-block compilation uses an in-memory promise cache keyed by source + preamble + engine.
9. Project scans are bounded to the source ancestry and stop at the vault root.

## Build directories

Project and fragment outputs live below the operating-system temp directory, not the vault. This avoids sync/indexing churn and accidental commits.

## Security boundaries

TeX is executable document processing software. Even with shell escape disabled, trusted local documents may read files available to TeX through normal mechanisms.

Defaults:

- `shell: false` for Node child processes;
- `--shell-escape` never enabled implicitly;
- no dependency downloads;
- external SVG output is sanitized before insertion;
- no telemetry/network services.

## Rust boundary

The parser/build orchestration layer is deliberately isolated behind small TypeScript modules. A future Rust/WASM or Rust sidecar implementation can replace SyncTeX parsing, project parsing, log parsing, hashing, or structural LaTeX parsing after benchmarks show a real bottleneck.
