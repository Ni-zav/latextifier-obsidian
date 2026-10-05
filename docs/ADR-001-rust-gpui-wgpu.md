# ADR-001: Do not use GPUI/wgpu as the primary Obsidian UI

- Status: accepted
- Date: 2026-10-05

## Context

The product needs low-latency Markdown LaTeX rendering and a full TeX editor/PDF workflow inside Obsidian. Rust, GPUI, and wgpu were considered as a way to maximize performance.

## Decision

Use **TypeScript + Obsidian + CodeMirror + Obsidian's bundled PDF.js** for the in-app interface.

Rust remains an optional future implementation language for measured parser/build hotspots or a separate companion process. GPUI/wgpu is not part of the default plugin runtime.

## Why

Obsidian community plugins run as JavaScript/TypeScript inside Electron. GPUI owns native windows and does not render into a normal Obsidian workspace pane without IPC and platform-specific binaries.

The dominant costs are TeX compilation and PDF decoding/rasterization. Moving lightweight orchestration and text parsing to Rust before profiling adds packaging and serialization overhead without removing those costs.

PDF.js also preserves text layers, selection, links, accessibility semantics, and browser integration that a custom wgpu renderer would need to rebuild.

## Revisit when

Use Rust when profiling shows a material bottleneck in very large project parsing, SyncTeX parsing, or when a persistent standalone compiler daemon becomes a product requirement.
