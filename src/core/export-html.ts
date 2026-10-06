import { promises as fs } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import type { ProjectSnapshot } from "./project-index";

export interface PortableExportResult {
  path: string;
  bytes: number;
}

export async function exportPortableProjectHtml(
  snapshot: ProjectSnapshot,
  pdfData: Uint8Array | null
): Promise<PortableExportResult> {
  const rootDir = dirname(snapshot.root);
  const stem = basename(snapshot.root, extname(snapshot.root));
  const outputPath = join(rootDir, stem + ".latextifier.html");

  const sources = await Promise.all(
    [...new Set([...snapshot.files, ...snapshot.bibFiles])].map(async (file) => ({
      file,
      text: await readUtf8(file)
    }))
  );

  const pdf = pdfData && pdfData.byteLength > 0
    ? "data:application/pdf;base64," + Buffer.from(pdfData).toString("base64")
    : "";

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>" + escapeHtml(stem) + " — Latextifier portable project</title>",
    "<style>" + portableCss() + "</style>",
    "</head>",
    "<body>",
    '<header class="hero">',
    '<div><p class="eyebrow">Latextifier portable project</p><h1>' + escapeHtml(basename(snapshot.root)) + "</h1></div>",
    '<div class="stats">',
    stat("Files", snapshot.files.length + snapshot.bibFiles.length),
    stat("Sections", snapshot.outline.length),
    stat("Labels", snapshot.labels.length),
    stat("Citations", snapshot.citations.length),
    stat("TODOs", snapshot.todos.length),
    "</div>",
    "</header>",
    '<main class="layout">',
    '<aside class="rail">',
    "<h2>Structure</h2>",
    outlineHtml(snapshot, rootDir),
    "<h2>TODOs</h2>",
    todosHtml(snapshot, rootDir),
    "<h2>References</h2>",
    referencesHtml(snapshot),
    "<h2>Citations</h2>",
    citationsHtml(snapshot),
    "</aside>",
    '<section class="content">',
    pdf ? '<section class="panel"><h2>Compiled PDF</h2><object class="pdf" data="' + pdf + '" type="application/pdf"><p>The embedded PDF cannot be displayed by this browser.</p></object></section>' : "",
    '<section class="panel"><h2>Project source</h2>' + sources.map((entry) => sourceHtml(entry.file, entry.text, rootDir)).join("") + "</section>",
    "</section>",
    "</main>",
    '<footer>Generated locally by Latextifier. No scripts, network requests, or external assets are required.</footer>',
    "</body>",
    "</html>"
  ].join("\n");

  await fs.writeFile(outputPath, html, "utf8");
  return { path: outputPath, bytes: Buffer.byteLength(html, "utf8") };
}

function outlineHtml(snapshot: ProjectSnapshot, rootDir: string): string {
  if (snapshot.outline.length === 0) return '<p class="empty">No document structure.</p>';
  return '<nav class="outline">' + snapshot.outline.map((item) => {
    const fileId = fileAnchor(item.file);
    const indent = Math.max(0, item.level) * 12;
    return '<a style="padding-left:' + String(indent) + 'px" href="#' + fileId + '">'
      + escapeHtml(item.title)
      + '<small>' + escapeHtml(shortPath(rootDir, item.file)) + ":" + String(item.line) + "</small></a>";
  }).join("") + "</nav>";
}

function todosHtml(snapshot: ProjectSnapshot, rootDir: string): string {
  if (snapshot.todos.length === 0) return '<p class="empty">No TODOs.</p>';
  return '<ul class="compact">' + snapshot.todos.map((item) =>
    "<li><strong>" + escapeHtml(item.text) + "</strong><small>"
      + escapeHtml(shortPath(rootDir, item.file)) + ":" + String(item.line) + "</small></li>"
  ).join("") + "</ul>";
}

function referencesHtml(snapshot: ProjectSnapshot): string {
  const refs = snapshot.references.filter((item) => item.kind === "ref");
  if (refs.length === 0) return '<p class="empty">No label references.</p>';
  return '<ul class="compact">' + refs.slice(0, 250).map((item) =>
    "<li><code>" + escapeHtml(item.from) + "</code> → <code>" + escapeHtml(item.to) + "</code></li>"
  ).join("") + "</ul>";
}

function citationsHtml(snapshot: ProjectSnapshot): string {
  if (snapshot.citations.length === 0) return '<p class="empty">No citations.</p>';
  return '<ul class="compact">' + snapshot.citations.slice(0, 300).map((item) => {
    const detail = [item.author, item.year, item.title].filter(Boolean).join(" · ");
    return "<li><code>" + escapeHtml(item.key) + "</code>"
      + (detail ? "<small>" + escapeHtml(detail) + "</small>" : "") + "</li>";
  }).join("") + "</ul>";
}

function sourceHtml(file: string, text: string | null, rootDir: string): string {
  const title = shortPath(rootDir, file);
  const body = text === null
    ? '<p class="empty">File could not be read when the export was generated.</p>'
    : '<pre><code>' + numberedSource(text) + "</code></pre>";
  return '<details class="source" id="' + fileAnchor(file) + '"><summary>'
    + escapeHtml(title) + "</summary>" + body + "</details>";
}

function numberedSource(text: string): string {
  return text.split(/\r?\n/).map((line, index) =>
    '<span class="line"><span class="ln">' + String(index + 1) + '</span><span class="src">'
      + escapeHtml(line || " ") + "</span></span>"
  ).join("\n");
}

function stat(label: string, value: number): string {
  return '<div><strong>' + String(value) + "</strong><span>" + escapeHtml(label) + "</span></div>";
}

function shortPath(rootDir: string, file: string): string {
  const value = relative(rootDir, file);
  return value || basename(file);
}

function fileAnchor(file: string): string {
  return "file-" + Buffer.from(file).toString("base64url").slice(0, 64);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readUtf8(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

function portableCss(): string {
  return [
    ":root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;--bg:#101114;--panel:#181a20;--muted:#9298a6;--text:#f2f4f8;--line:#2b2f38;--accent:#9b87f5}",
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}a{color:inherit}",
    ".hero{display:flex;gap:28px;justify-content:space-between;align-items:end;padding:28px 32px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#171922,#111216)}",
    "h1,h2{margin:0}.eyebrow{margin:0 0 7px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}",
    ".stats{display:flex;flex-wrap:wrap;gap:8px}.stats div{min-width:72px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#ffffff08}.stats strong,.stats span{display:block}.stats span{color:var(--muted);font-size:11px}",
    ".layout{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);min-height:calc(100vh - 120px)}.rail{padding:22px 18px;border-right:1px solid var(--line);overflow:auto}.rail h2{margin:18px 0 8px;font-size:13px}",
    ".content{padding:22px;min-width:0}.panel{margin-bottom:20px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.panel>h2{margin-bottom:14px;font-size:16px}",
    ".outline{display:flex;flex-direction:column}.outline a{display:block;padding:5px 6px;border-radius:6px;text-decoration:none;font-size:13px}.outline a:hover{background:#ffffff0c}.outline small,.compact small{display:block;color:var(--muted);font-size:10px}",
    ".compact{margin:0;padding-left:18px;font-size:12px}.compact li{margin:5px 0}.empty{color:var(--muted);font-size:12px}",
    ".pdf{width:100%;height:72vh;border:1px solid var(--line);border-radius:8px;background:white}.source{margin:8px 0;border:1px solid var(--line);border-radius:9px;overflow:hidden}.source summary{cursor:pointer;padding:9px 11px;font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#ffffff08}",
    ".source pre{margin:0;padding:12px;overflow:auto;background:#08090b;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.line{display:grid;grid-template-columns:48px minmax(max-content,1fr)}.ln{padding-right:12px;color:#5e6574;text-align:right;user-select:none}.src{white-space:pre}",
    "footer{padding:16px 32px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}",
    "@media(max-width:800px){.hero{align-items:start;flex-direction:column}.layout{display:block}.rail{border-right:0;border-bottom:1px solid var(--line)}.content{padding:12px}.pdf{height:65vh}}"
  ].join("");
}
