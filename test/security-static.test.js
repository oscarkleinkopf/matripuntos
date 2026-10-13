import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CSP_HEADER, CSP_META } from "../scripts/csp.mjs";

const appDir = fileURLToPath(new URL("../app/", import.meta.url));

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

test("CSP forbids inline scripts and eval", () => {
  const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
  const match = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(match);
  assert.equal(match[1], CSP_META);
  assert.match(CSP_HEADER, /script-src 'self'/);
  assert.match(CSP_HEADER, /frame-ancestors 'none'/);
  assert.doesNotMatch(CSP_META, /unsafe-inline/);
  assert.doesNotMatch(CSP_META, /unsafe-eval/);
  assert.doesNotMatch(CSP_HEADER, /unsafe-inline/);
  assert.doesNotMatch(CSP_HEADER, /unsafe-eval/);
  assert.match(CSP_META, /default-src 'none'/);
});

test("service worker shell files exist", () => {
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  const paths = [...sw.matchAll(/"(\/[^"]*)"/g)].map((match) => match[1]);
  assert.ok(paths.includes("/js/app.js"));
  for (const path of paths) {
    if (path === "/") continue;
    assert.equal(existsSync(join(appDir, path.slice(1))), true, path);
  }
});

test("the app shell does not call out to third parties", () => {
  const files = walk(appDir).filter((file) => /\.(js|css|html|svg|webmanifest)$/.test(file));
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /innerHTML|document\.write|new Function|eval\(/);
  assert.doesNotMatch(source, /\.style\.|setAttribute\(\s*["']style["']/);
  assert.doesNotMatch(source, /fonts\.google|googletagmanager|google-analytics|cdn\.|unpkg|jsdelivr|cloudflare/i);
  const urls = source.match(/https?:\/\/[^"'\s)]+/g) || [];
  const unexpected = urls.filter((url) => !url.startsWith("http://www.w3.org/2000/svg"));
  assert.deepEqual(unexpected, []);
});
