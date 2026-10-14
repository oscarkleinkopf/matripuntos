import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ARGON2_PINS, hashArgon2id } from "../app/js/argon2.js";
import { MpError } from "../app/js/errors.js";
import {
  CLIPBOARD_CLEAR_MS,
  CLIPBOARD_COPIED,
  CLIPBOARD_WARNING,
  clearClipboardIfMatch,
  planClipboardClear,
} from "../app/js/clipboard.js";
import {
  createVaultSecrets,
  decryptJson,
  encryptJson,
  migrateKdf,
  needsKdfMigration,
  ratePassphrase,
  rewrapWithPassphrase,
  unlockWithPassphrase,
  unlockWithPin,
} from "../app/js/crypto.js";
import {
  INVITE_TTL_MS,
  assertInviteEpoch,
  assertInviteUnused,
  decodeInvite,
  encodeInvite,
  inviteUseId,
  readInviteFromLocation,
  rememberInviteUse,
} from "../app/js/invite.js";
import { DICEWARE_SHA256, DICEWARE_WORDS, parseDicewareList, suggestPassphrase } from "../app/js/passphrase.js";

const weak = { allowWeak: true };
const phrase = "frase-prueba-01";
const nextPhrase = "otra-frase-larga-02";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inviteSource(secrets, epoch = secrets.epoch) {
  return {
    spaceId: secrets.spaceId,
    createdAt: "2026-10-13T15:00:00.000Z",
    epoch,
    kdf: secrets.kdf,
    wrappedDek: secrets.wrappedDek,
    verifier: secrets.verifier,
    profile: { iv: "aXY2aXY2aXY2", ciphertext: "cHJvZmlsZQ==" },
  };
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

test("argon2id matches the published test vector", async () => {
  const tag = await hashArgon2id({
    password: hexToBytes("01".repeat(32)),
    salt: hexToBytes("02".repeat(16)),
    passes: 3,
    memorySize: 32,
    parallelism: 4,
    secret: hexToBytes("03".repeat(8)),
    ad: hexToBytes("04".repeat(12)),
    tagLength: 32,
  });
  assert.equal(bytesToHex(tag), "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659");
});

test("vendored argon2 and the wordlist match their pins", () => {
  for (const [name, expected] of Object.entries(ARGON2_PINS)) {
    const bytes = readFileSync(new URL(`../app/vendor/argon2id/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
  const wordlist = readFileSync(new URL("../app/vendor/diceware/eff-large-wordlist.txt", import.meta.url));
  assert.equal(createHash("sha256").update(wordlist).digest("hex"), DICEWARE_SHA256);
  const words = parseDicewareList(wordlist.toString("utf8"));
  assert.equal(words.length, DICEWARE_WORDS);
  assert.equal(words[0], "abacus");
  assert.equal(words.at(-1), "zoom");
});

test("new spaces round-trip with argon2id and a legacy PBKDF2 space still opens", async () => {
  const created = await createVaultSecrets(phrase, "123456", weak);
  assert.equal(created.kdf.name, "Argon2id");
  assert.equal(created.kdf.v, 2);
  const packed = await encryptJson(created.dek, { text: "sigue" }, "caja");
  const opened = await unlockWithPassphrase(created, phrase, weak);
  assert.deepEqual(await decryptJson(opened, packed, "caja"), { text: "sigue" });
  const byPin = await unlockWithPin(created, "123456", weak);
  assert.deepEqual(await decryptJson(byPin, packed, "caja"), { text: "sigue" });

  const legacy = await createVaultSecrets(phrase, "123456", { kdf: "pbkdf2", iterations: 1_000, allowWeak: true });
  assert.equal(legacy.kdf.name, "PBKDF2");
  assert.equal(legacy.kdf.v, 1);
  assert.equal(needsKdfMigration(legacy), true);
  const legacyPacked = await encryptJson(legacy.dek, { text: "sigue" }, "caja");
  const legacyKey = await unlockWithPassphrase(legacy, phrase, { allowWeak: true });
  assert.deepEqual(await decryptJson(legacyKey, legacyPacked, "caja"), { text: "sigue" });
});

test("migration keeps the data key and moves the wrap to argon2id", async () => {
  const legacy = await createVaultSecrets(phrase, "123456", { kdf: "pbkdf2", iterations: 1_000, allowWeak: true });
  const packed = await encryptJson(legacy.dek, { ok: 1 }, "caja");
  const migrated = await migrateKdf(legacy, phrase, "123456", weak);
  assert.equal(migrated.kdf.name, "Argon2id");
  assert.equal(migrated.epoch, 0);
  const material = {
    ...legacy,
    kdf: migrated.kdf,
    wrappedDek: migrated.wrappedDek,
    pin: migrated.pin,
  };
  const opened = await unlockWithPassphrase(material, phrase, weak);
  assert.deepEqual(await decryptJson(opened, packed, "caja"), { ok: 1 });
  const byPin = await unlockWithPin(material, "123456", weak);
  assert.deepEqual(await decryptJson(byPin, packed, "caja"), { ok: 1 });
  assert.equal(needsKdfMigration(material), false);
});

test("rotation rewraps the data key and rejects the old invite", async () => {
  const secrets = await createVaultSecrets(phrase, "123456", weak);
  const packed = await encryptJson(secrets.dek, { text: "sigue" }, "caja");
  const now = Date.parse("2026-10-13T15:00:00.000Z");
  const oldCode = encodeInvite(inviteSource(secrets), { now, allowWeak: true });
  const rotated = await rewrapWithPassphrase(secrets, phrase, nextPhrase, "654321", weak);
  assert.equal(rotated.epoch, (secrets.epoch || 0) + 1);
  const stale = decodeInvite(oldCode, { now: now + 1_000, allowWeak: true });
  assert.throws(() => assertInviteEpoch(stale, rotated.epoch), (error) => error.code === "invite-stale");
  const freshCode = encodeInvite(inviteSource({ ...secrets, ...rotated }), { now, allowWeak: true });
  const fresh = decodeInvite(freshCode, { now: now + 1_000, allowWeak: true });
  assert.doesNotThrow(() => assertInviteEpoch(fresh, rotated.epoch));
  const material = { ...secrets, kdf: rotated.kdf, wrappedDek: rotated.wrappedDek, pin: rotated.pin, epoch: rotated.epoch };
  const opened = await unlockWithPassphrase(material, nextPhrase, weak);
  assert.deepEqual(await decryptJson(opened, packed, "caja"), { text: "sigue" });
  await assert.rejects(() => unlockWithPassphrase(material, phrase, weak));
  const json = new TextDecoder().decode(Buffer.from(freshCode.slice("mp1.".length), "base64url"));
  assert.equal(json.includes(nextPhrase), false);
  assert.equal(json.includes(phrase), false);
});

test("invites expire and are one-time on this phone", async () => {
  const secrets = await createVaultSecrets(phrase, "123456", weak);
  const now = 1_000_000;
  const code = encodeInvite(inviteSource(secrets), { now, allowWeak: true });
  const invite = decodeInvite(code, { now: now + 1_000, allowWeak: true });
  assert.throws(
    () => decodeInvite(code, { now: now + INVITE_TTL_MS, allowWeak: true }),
    (error) => error.code === "invite-expired",
  );
  const storage = memoryStorage();
  const id = await inviteUseId(invite);
  assertInviteUnused(storage, id);
  rememberInviteUse(storage, id);
  assert.throws(() => assertInviteUnused(storage, id), (error) => error.code === "invite-used");
});

test("the invite fragment is removed before it is decoded", () => {
  const calls = [];
  const result = readInviteFromLocation(
    { pathname: "/index.html", search: "?x=1", hash: "#mp1.no-es" },
    (url) => calls.push(["strip", url]),
    () => {
      calls.push(["decode"]);
      throw new MpError("invite", "no");
    },
  );
  assert.deepEqual(calls, [["strip", "/index.html?x=1"], ["decode"]]);
  assert.equal(result.stripped, true);
  assert.equal(result.invite, null);
  assert.equal(result.error.code, "invite");
  assert.equal("/index.html?x=1".includes("#"), false);
  const absent = readInviteFromLocation({ pathname: "/", search: "", hash: "" }, () => {}, () => ({}));
  assert.equal(absent.stripped, false);
});

test("passphrase meter rejects weak secrets and can suggest a diceware phrase", async () => {
  assert.equal(ratePassphrase("frase-prueba-01").accept, true);
  assert.equal(ratePassphrase("frase-prueba-01").level, "justa");
  assert.equal(ratePassphrase("aaaaaaaaaaaa").accept, false);
  assert.equal(ratePassphrase("password1234").accept, false);
  assert.equal(ratePassphrase("corta").accept, false);
  let cursor = 0;
  const suggestion = await suggestPassphrase(6, () => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, cursor);
    cursor += 7919;
    return bytes;
  });
  const words = suggestion.split(" ");
  assert.equal(words.length, 6);
  assert.equal(new Set(words).size, 6);
  const rated = ratePassphrase(suggestion);
  assert.equal(rated.accept, true);
  assert.equal(rated.level, "fuerte");
});

test("clipboard clear only erases the copied secret", async () => {
  assert.match(CLIPBOARD_WARNING, /portapapeles/);
  assert.match(CLIPBOARD_COPIED, /45 segundos/);
  assert.equal(CLIPBOARD_CLEAR_MS, 45_000);
  const plan = planClipboardClear(1_000);
  assert.equal(plan.clearAt, 46_000);
  const clipboard = {
    text: "mp1.secreto",
    async readText() { return this.text; },
    async writeText(value) { this.text = value; },
  };
  assert.deepEqual(await clearClipboardIfMatch(clipboard, "otro"), { cleared: false, reason: "changed" });
  assert.equal(clipboard.text, "mp1.secreto");
  assert.deepEqual(await clearClipboardIfMatch(clipboard, "mp1.secreto"), { cleared: true, reason: "cleared" });
  assert.equal(clipboard.text, "");
});
