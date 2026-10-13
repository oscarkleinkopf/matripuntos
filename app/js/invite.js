import { MpError } from "./errors.js";
import { bytesToB64Url, b64UrlToBytes, randomId } from "./bytes.js";
import { normalizeKdf } from "./crypto.js";

const PREFIX = "mp1.";
export const INVITE_TTL_MS = 15 * 60 * 1000;
const USED_KEY = "matripuntos-invite-used";

function expectString(value, code) {
  if (typeof value !== "string" || !value) throw new MpError(code, "La invitación está incompleta.");
  return value;
}

export function consumeInviteLocation(loc) {
  const pathname = String(loc?.pathname || "/");
  const search = String(loc?.search || "");
  const hash = String(loc?.hash || "");
  return {
    hash,
    nextUrl: `${pathname}${search}`,
    shouldStrip: hash.startsWith("#mp1."),
  };
}

export function readInviteFromLocation(loc, replace, decode) {
  const plan = consumeInviteLocation(loc);
  if (!plan.shouldStrip) return { invite: null, error: null, stripped: false };
  replace(plan.nextUrl);
  try {
    return { invite: decode(plan.hash), error: null, stripped: true };
  } catch (error) {
    return { invite: null, error, stripped: true };
  }
}

export function encodeInvite(source, options = {}) {
  const now = options.now ?? Date.now();
  const epoch = Number.isInteger(source.epoch) ? source.epoch : 0;
  const exp = typeof source.exp === "string" ? source.exp : new Date(now + INVITE_TTL_MS).toISOString();
  const payload = {
    v: 1,
    id: typeof source.id === "string" && source.id ? source.id : randomId(),
    epoch,
    exp,
    spaceId: expectString(source.spaceId, "invite"),
    createdAt: expectString(source.createdAt, "invite"),
    kdf: normalizeKdf(source.kdf, options),
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

export function decodeInvite(input, options = {}) {
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
  const kdf = normalizeKdf(data.kdf, options);
  const now = options.now ?? Date.now();
  let exp = "";
  if (typeof data.exp === "string" && data.exp) {
    const when = Date.parse(data.exp);
    if (!Number.isFinite(when)) throw new MpError("invite", "Esta invitación no trae un vencimiento válido.");
    if (when <= now) throw new MpError("invite-expired", "Esta invitación ya venció. Pide otra.");
    exp = data.exp;
  } else if (kdf.name === "Argon2id") {
    throw new MpError("invite-expired", "Esta invitación no trae vencimiento. Pide otra.");
  }
  return {
    v: 1,
    id: typeof data.id === "string" ? data.id : "",
    epoch: Number.isInteger(data.epoch) ? data.epoch : 0,
    exp,
    spaceId: expectString(data.spaceId, "invite"),
    createdAt: expectString(data.createdAt, "invite"),
    kdf,
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

export async function inviteUseId(invite) {
  const raw = invite?.id || `${invite?.spaceId || ""}:${invite?.wrappedDek?.wrapped || ""}:${invite?.exp || ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function usedSet(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(USED_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function assertInviteUnused(storage, id) {
  if (!id || usedSet(storage).has(id)) {
    throw new MpError("invite-used", "Esta invitación ya se usó en este teléfono.");
  }
}

export function rememberInviteUse(storage, id) {
  if (!id) return;
  const used = usedSet(storage);
  used.add(id);
  try {
    storage?.setItem?.(USED_KEY, JSON.stringify([...used].slice(-40)));
  } catch {
    /* si el almacenamiento falla, la copia en memoria de esta llamada no alcanza */
  }
}

export function assertInviteEpoch(invite, localEpoch) {
  const current = Number.isInteger(localEpoch) ? localEpoch : 0;
  const seen = Number.isInteger(invite?.epoch) ? invite.epoch : 0;
  if (seen < current) {
    throw new MpError("invite-stale", "Esta invitación quedó invalidada. Pide un código nuevo.");
  }
}

export function inviteLink(code, origin = "") {
  const base = String(origin || "").replace(/#.*$/, "").replace(/\/$/, "");
  return `${base}/#${code}`;
}
