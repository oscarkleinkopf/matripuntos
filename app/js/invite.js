import { MpError } from "./errors.js";
import { bytesToB64Url, b64UrlToBytes } from "./bytes.js";
import { assertKdfIterations } from "./crypto.js";

const PREFIX = "mp1.";

function expectString(value, code) {
  if (typeof value !== "string" || !value) throw new MpError(code, "La invitación está incompleta.");
  return value;
}

export function encodeInvite(source) {
  const payload = {
    v: 1,
    spaceId: expectString(source.spaceId, "invite"),
    createdAt: expectString(source.createdAt, "invite"),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: assertKdfIterations(source.kdf?.iterations),
      salt: expectString(source.kdf?.salt, "invite"),
    },
    wrappedDek: {
      iv: expectString(source.wrappedDek?.iv, "invite"),
      wrapped: expectString(source.wrappedDek?.wrapped, "invite"),
    },
    verifier: {
      iv: expectString(source.verifier?.iv, "invite"),
      ciphertext: expectString(source.verifier?.ciphertext, "invite"),
    },
    profile: {
      iv: expectString(source.profile?.iv, "invite"),
      ciphertext: expectString(source.profile?.ciphertext, "invite"),
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return PREFIX + bytesToB64Url(bytes);
}

export function decodeInvite(input) {
  const raw = String(input ?? "").trim();
  const hashAt = raw.indexOf("#");
  const fragment = (hashAt >= 0 ? raw.slice(hashAt + 1) : raw).replace(/^#/, "");
  if (!fragment.startsWith(PREFIX)) throw new MpError("invite", "Eso no parece una invitación de Matripuntos.");
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(b64UrlToBytes(fragment.slice(PREFIX.length))));
  } catch {
    throw new MpError("invite", "No pude leer la invitación.");
  }
  if (!data || data.v !== 1) throw new MpError("invite", "Esta invitación es de otra versión.");
  return {
    v: 1,
    spaceId: expectString(data.spaceId, "invite"),
    createdAt: expectString(data.createdAt, "invite"),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: assertKdfIterations(data.kdf?.iterations),
      salt: expectString(data.kdf?.salt, "invite"),
    },
    wrappedDek: {
      iv: expectString(data.wrappedDek?.iv, "invite"),
      wrapped: expectString(data.wrappedDek?.wrapped, "invite"),
    },
    verifier: {
      iv: expectString(data.verifier?.iv, "invite"),
      ciphertext: expectString(data.verifier?.ciphertext, "invite"),
    },
    profile: {
      iv: expectString(data.profile?.iv, "invite"),
      ciphertext: expectString(data.profile?.ciphertext, "invite"),
    },
  };
}

export function inviteLink(code, origin = "") {
  const base = String(origin || "").replace(/#.*$/, "").replace(/\/$/, "");
  return `${base}/#${code}`;
}
