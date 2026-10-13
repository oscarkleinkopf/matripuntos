export const CSP_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "script-src 'self'",
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
