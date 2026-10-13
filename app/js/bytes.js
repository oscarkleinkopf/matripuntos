export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomId() {
  return [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bytesToB64(bytes) {
  const chunk = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function b64ToBytes(value) {
  const binary = atob(String(value ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function b64UrlToBytes(value) {
  const cleaned = String(value ?? "").replaceAll("-", "+").replaceAll("_", "/");
  const pad = cleaned.length % 4 === 0 ? "" : "=".repeat(4 - (cleaned.length % 4));
  return b64ToBytes(cleaned + pad);
}

export function zeroize(bytes) {
  if (bytes && typeof bytes.fill === "function") bytes.fill(0);
}
