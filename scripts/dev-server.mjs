import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CSP_HEADER } from "./csp.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "app") + sep;
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const headers = {
  "Content-Security-Policy": CSP_HEADER,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "private, max-age=0",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\0") || pathname.includes("..")) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("No.");
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    const relative = pathname.replace(/^\/+/, "");
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("No.");
      return;
    }
    const data = await readFile(file);
    response.writeHead(200, {
      ...headers,
      "Content-Type": types[extname(file)] || "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...headers });
    response.end("No está.");
  }
}).listen(port, host, () => {
  process.stdout.write(`Matripuntos en http://${host}:${port}\n`);
});
