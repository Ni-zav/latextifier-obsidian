# Competitive feature matrix

Research date: 2026-10-06.

This matrix is used as a release gate, not as marketing copy. "Latextifier" refers to the code on this branch.

| Capability | Latextifier 0.2 | Texifier | LaTeX Live |
| --- | --- | --- | --- |
| Real .tex project editing | Yes | Yes | Yes |
| LaTeX rendering inside ordinary Obsidian Markdown | Yes, MathJax fast path + full TeX blocks | No Obsidian integration | No Markdown-first dual lane |
| Live rendered math inside .tex source | Yes, viewport-scoped | No source replacement mode documented | Yes |
| Live theorem/proof reading in source | Yes | No equivalent documented | Yes |
| Live TikZ/table compiled blocks inside source | Yes | No equivalent documented | Yes |
| Persistent PDF beside source | Yes | Yes | Yes |
| Last-good PDF retained on compile error | Yes | Yes | Yes |
| Forward/inverse SyncTeX | Yes | Yes | Yes |
| Continuous source/PDF scroll lock | Yes | Yes | Not documented as continuous scroll lock |
| Multi-file root detection | Yes | Yes | Yes |
| Project outline/files/TODOs | Yes | Yes | Yes/partial |
| Whole-project text search | Yes | Yes | Not a headline feature |
| Project-wide labels/citations/.bib completion | Yes | Yes | Via TexLab |
| Custom command/environment completion | Yes | Yes | Via TexLab |
| TexLab LSP completion/hover/diagnostics/snippets | Yes, optional | No TexLab integration | Yes |
| Built-in zero-dependency project intelligence fallback | Yes | Yes | Partial |
| Auto-close environments | Yes | Yes | Yes |
| Auto indentation/list continuation | Yes | Yes | Yes |
| Bracket + dollar pairing | Yes | Yes | Editor/toolchain dependent |
| Comment/uncomment hotkey | Yes | Yes | Editor/toolchain dependent |
| Symbol palette | Yes | Not central | No equivalent documented |
| Reference graph | Yes, project labels/references | No equivalent documented | Yes, proof-reference graph |
| Markdown + .tex in one Obsidian plugin | Yes | No | No Markdown rendering lane |
| Project-context fragment compilation | Yes | N/A | Yes for live source |
| standalone.cls fallback | Yes | N/A | N/A |
| Self-contained project HTML export with embedded PDF/source/index | Yes | Project/source/PDF sharing, not this format | Yes, semantic reading-edition HTML |
| pdfLaTeX/XeLaTeX/LuaLaTeX CI fixtures | Yes | Product supports external typesetters | Yes |
| latexmk bibliography CI | Yes | Yes | Yes |
| SyncTeX round-trip tested in CI | Yes | Product feature | Yes |
| Installable CI artifact + tagged release packaging | Yes | App distribution | Yes |

## Where Latextifier is intentionally stronger

1. **Hybrid Obsidian workflow.** Markdown notes and real LaTeX projects use one rendering/build stack.
2. **Continuous SyncTeX + live-source reading.** Texifier documents continuous scroll lock; LaTeX Live documents one-off source/PDF navigation. Latextifier combines continuous scroll lock with in-source rendered math/theorems/compiled blocks.
3. **Project intelligence without mandatory LSP.** The built-in index provides refs, citations, custom commands, environments, outline, TODOs, project search, and a reference graph; TexLab adds richer language intelligence rather than being a hard dependency.
4. **Validation.** CI installs a real TeX toolchain and exercises pdfLaTeX, XeLaTeX, LuaLaTeX, latexmk bibliography, multi-file dependencies, and SyncTeX round trips.
5. **Portable project snapshot.** Export can carry the compiled PDF, project metadata, references/citations/TODOs, and escaped source in one offline HTML file.

## Where competitors remain stronger or more mature

- Texifier is a long-lived dedicated native LaTeX product with mature platform-specific polish, typesetter configuration, project recovery, and broader production history.
- LaTeX Live already has demonstrated template galleries, a richer semantic reading-edition exporter, and user-facing recordings/benchmarks.
- Latextifier 0.2 still needs real Obsidian dogfooding across Windows/macOS/Linux and varied templates before any universal reliability claim is justified.

The engineering target is therefore **a better combined Obsidian LaTeX workflow**, not the claim that every mature edge case of both products has already been reproduced.

## Primary references

- Texifier workspace: https://www.texifier.com/docs/apps/workspace
- Texifier editor aids: https://www.texifier.com/docs/apps/workspace/editor/aids
- Texifier source/PDF sync and continuous scroll lock: https://www.texifier.com/docs/apps/workspace/pdf-viewer/syncing-with-editor
- Texifier toolbar/project search: https://www.texifier.com/docs/apps/workspace/toolbar
- LaTeX Live: https://github.com/qiulinfan/obsidian-latex-live
