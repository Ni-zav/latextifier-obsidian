import { App, Modal } from "obsidian";
import type { ProjectLocation, ProjectReference, ProjectSnapshot } from "../core/project-index";

export interface ReferenceGraphCallbacks {
  onOpen(location: ProjectLocation): void;
}

interface GraphNode {
  key: string;
  depth: number;
  x: number;
  y: number;
}

export class ReferenceGraphModal extends Modal {
  private focusKey = "";

  constructor(
    app: App,
    private readonly snapshot: ProjectSnapshot,
    private readonly callbacks: ReferenceGraphCallbacks
  ) {
    super(app);
    this.focusKey = pickInitialKey(snapshot);
  }

  onOpen(): void {
    this.modalEl.addClass("latextifier-graph-modal");
    this.titleEl.setText("LaTeX reference graph");

    const controls = this.contentEl.createDiv({ cls: "latextifier-graph-controls" });
    const select = controls.createEl("select", { cls: "dropdown" });
    const keys = graphKeys(this.snapshot);
    for (const key of keys) {
      select.createEl("option", { value: key, text: key });
    }
    select.value = this.focusKey;
    select.addEventListener("change", () => {
      this.focusKey = select.value;
      this.renderGraph();
    });

    const hint = controls.createSpan({
      cls: "latextifier-graph-hint",
      text: "Click a labeled node to open its source."
    });
    hint.setAttribute("aria-live", "polite");

    this.contentEl.createDiv({ cls: "latextifier-graph-canvas" });
    this.renderGraph();
  }

  private renderGraph(): void {
    const host = this.contentEl.querySelector<HTMLElement>(".latextifier-graph-canvas");
    if (!host) return;
    host.empty();

    const refs = this.snapshot.references.filter((item) => item.kind === "ref");
    if (refs.length === 0) {
      host.createDiv({ cls: "latextifier-navigator-empty", text: "No label references found." });
      return;
    }

    const nodes = layoutGraph(this.focusKey, refs, 72);
    if (nodes.length === 0) {
      host.createDiv({ cls: "latextifier-navigator-empty", text: "No connected references for this label." });
      return;
    }

    const width = 920;
    const height = Math.max(420, ...nodes.map((node) => node.y + 70));
    const svg = host.createSvg("svg", {
      attr: {
        viewBox: "0 0 " + String(width) + " " + String(height),
        role: "img",
        "aria-label": "Project reference graph"
      }
    });

    const byKey = new Map(nodes.map((node) => [node.key, node]));
    for (const edge of refs) {
      const from = byKey.get(edge.from);
      const to = byKey.get(edge.to);
      if (!from || !to) continue;
      const line = svg.createSvg("line", {
        attr: {
          x1: String(from.x + 74),
          y1: String(from.y + 17),
          x2: String(to.x - 4),
          y2: String(to.y + 17),
          class: "latextifier-graph-edge"
        }
      });
      line.setAttribute("vector-effect", "non-scaling-stroke");
    }

    for (const node of nodes) {
      const group = svg.createSvg("g", {
        attr: {
          class: "latextifier-graph-node" + (node.key === this.focusKey ? " is-focus" : ""),
          transform: "translate(" + String(node.x) + " " + String(node.y) + ")"
        }
      });
      group.createSvg("rect", {
        attr: {
          width: "148",
          height: "34",
          rx: "7",
          ry: "7"
        }
      });
      const label = group.createSvg("text", {
        attr: { x: "9", y: "21" }
      });
      label.textContent = truncate(node.key, 23);

      const location = this.snapshot.labels.find((item) => item.key === node.key);
      if (location) {
        group.addClass("is-clickable");
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "button");
        group.addEventListener("click", () => {
          this.close();
          this.callbacks.onOpen(location);
        });
        group.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          this.close();
          this.callbacks.onOpen(location);
        });
      }
    }
  }
}

function layoutGraph(focus: string, refs: ProjectReference[], limit: number): GraphNode[] {
  const adjacency = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const edge of refs) {
    addEdge(adjacency, edge.from, edge.to);
    addEdge(reverse, edge.to, edge.from);
  }

  const depth = new Map<string, number>([[focus, 0]]);
  const queue = [focus];
  while (queue.length > 0 && depth.size < limit) {
    const key = queue.shift();
    if (!key) break;
    const current = depth.get(key) ?? 0;
    const neighbors = new Set([
      ...(adjacency.get(key) ?? []),
      ...(reverse.get(key) ?? [])
    ]);
    for (const next of neighbors) {
      if (depth.has(next)) continue;
      depth.set(next, current + 1);
      queue.push(next);
      if (depth.size >= limit) break;
    }
  }

  if (depth.size === 1 && !adjacency.has(focus) && !reverse.has(focus)) return [];

  const buckets = new Map<number, string[]>();
  for (const [key, value] of depth) {
    const bucket = buckets.get(value) ?? [];
    bucket.push(key);
    buckets.set(value, bucket);
  }

  const result: GraphNode[] = [];
  for (const [layer, keys] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    keys.sort((a, b) => a.localeCompare(b));
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!key) continue;
      result.push({
        key,
        depth: layer,
        x: 24 + layer * 210,
        y: 24 + index * 52
      });
    }
  }
  return result;
}

function graphKeys(snapshot: ProjectSnapshot): string[] {
  const values = new Set<string>();
  for (const ref of snapshot.references) {
    if (!ref.from.startsWith("file:")) values.add(ref.from);
    if (snapshot.labels.some((label) => label.key === ref.to)) values.add(ref.to);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

function pickInitialKey(snapshot: ProjectSnapshot): string {
  const keys = graphKeys(snapshot);
  return keys[0] ?? snapshot.labels[0]?.key ?? "";
}

function addEdge(map: Map<string, Set<string>>, from: string, to: string): void {
  const set = map.get(from) ?? new Set<string>();
  set.add(to);
  map.set(from, set);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}
