import { MpError } from "./errors.js";

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBytes(url) {
  if (globalThis.process?.versions?.node) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    return new Uint8Array(await readFile(fileURLToPath(url)));
  }
  const response = await fetch(url);
  if (!response.ok) throw new MpError("asset", "No se pudo cargar un archivo de este teléfono.");
  return new Uint8Array(await response.arrayBuffer());
}

export async function readPinnedBytes(url, expectedHex) {
  const bytes = await readBytes(url);
  const actual = await sha256Hex(bytes);
  if (actual !== expectedHex) {
    throw new MpError("asset-pin", "Un archivo de la app no coincide con su pin.");
  }
  return bytes;
}
