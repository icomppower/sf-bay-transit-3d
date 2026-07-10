// Minimal static file server for running a battle locally.
// Real map tiles must be loaded over http (same-origin); file:// will not work.
// Usage: node tools/serve.js [port]    (NO_OPEN=1 or --no-open suppresses the browser launch — for scripts/CI)
// Single-instance by design: serves on PORT (default 5050) and opens your browser once. If that port is already in
// use (you re-ran the launcher, or a tab is still open), it does NOT spawn a second server or open another tab — it
// points you back to the running one. To run a second battle alongside it: PORT=5051 node tools/serve.js
const http = require("http"), fs = require("fs"), path = require("path"), { exec } = require("child_process");
const root = path.resolve(__dirname, "..");
const preferred = parseInt(process.env.PORT || process.argv.slice(2).find(a => /^\d+$/.test(a)) || "5050", 10);
const noOpen = process.argv.includes("--no-open") || process.env.NO_OPEN === "1";
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".mp3":"audio/mpeg" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = path.join(root, p);
  const rel = path.relative(root, fp); if (rel.startsWith("..") || path.isAbsolute(rel)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(fp)] || "application/octet-stream",
      "cache-control": "no-store, must-revalidate" });
    res.end(data);
  });
});

// Open the default browser to the bound URL — best-effort, never crashes the server. NO_OPEN/--no-open skips it.
function openBrowser(url) {
  if (noOpen) return;
  const cmd = process.platform === "win32" ? `start "" "${url}"`
            : process.platform === "darwin" ? `open "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.log(`(open your browser to ${url})`); });
}

// Reuse-first lifecycle: if the port is already taken it is (almost always) an already-running copy of this launcher.
// Re-launching must NOT spawn a duplicate server or open another browser tab — doing so silently piles up servers +
// tabs + WebGL contexts across repeated runs until the browser's ~16-context cap is hit, which then fails EVERY launch
// with "Error creating WebGL context". So on EADDRINUSE we point the user
// back to the running instance and exit cleanly — never hunt to a new port, never open another tab.
server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    const url = `http://localhost:${preferred}`;
    console.log(`A server is already running at ${url} — switch to that browser tab (don't re-launch).`);
    console.log(`To run a second battle alongside it, use another port:  PORT=${preferred + 1} node tools/serve.js`);
    process.exit(0);   // clean exit — no duplicate server, nothing orphaned, no extra WebGL context
  }
  console.error(e.message); process.exit(1);
});
server.on("listening", () => { const url = `http://localhost:${server.address().port}`; console.log(`serving ${root} on ${url}`); openBrowser(url); });
server.listen(preferred);
