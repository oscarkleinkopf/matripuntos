// 'wasm-unsafe-eval' is required so WebAssembly.instantiate can compile the
// vendored Argon2id module. It does not allow eval, new Function, or inline scripts.
export const CSP_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
]);

export const CSP_HEADER = CSP_DIRECTIVES.join("; ");

export const CSP_META = CSP_DIRECTIVES.filter((directive) => !directive.startsWith("frame-ancestors")).join("; ");

export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": CSP_HEADER,
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=()",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
});

export function renderNetlifyHeaders() {
  const lines = ["/*"];
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    lines.push(`  ${name}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}
