import assert from "node:assert/strict";
import { test } from "node:test";
import { b64UrlToBytes } from "../app/js/bytes.js";
import { PROFILE_AAD } from "../app/js/constants.js";
import { ARGON2, buildMeta, createVaultSecrets, encryptJson } from "../app/js/crypto.js";
import { buildEncryptedExport, buildPlainExport, parseEncryptedExport, PLAIN_WARNING } from "../app/js/export.js";
import { decodeInvite, encodeInvite } from "../app/js/invite.js";
import { DICTATION_NOTICE } from "../app/js/speech.js";
import { MAX_AUDIO_MS } from "../app/js/audio.js";
import { SYNC, ciphertextEnvelope, pushCiphertext } from "../app/js/sync.js";

const weak = { iterations: 1_000, allowWeak: true };

test("invite carries setup ciphertext and never the passphrase", () => {
  const meta = {
    spaceId: "abc123",
    createdAt: "2026-10-13T15:00:00.000Z",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600_000, salt: "c2FsdHNhbHQ=" },
    wrappedDek: { iv: "aXY2aXY2aXY2", wrapped: "d3JhcHBlZC1rZXk=" },
    verifier: { iv: "aXY2aXY2aXY2", ciphertext: "Y2lwaGVydGV4dA==" },
    profile: { iv: "aXY2aXY2aXY2", ciphertext: "cHJvZmlsZQ==" },
    passphrase: "frase-prueba-01",
    pin: "123456",
  };
  const code = encodeInvite(meta);
  const json = new TextDecoder().decode(b64UrlToBytes(code.slice("mp1.".length)));
  assert.equal(json.includes("frase-prueba-01"), false);
  assert.equal(Object.hasOwn(JSON.parse(json), "passphrase"), false);
  assert.equal(Object.hasOwn(JSON.parse(json), "pin"), false);
  const decoded = decodeInvite(`#${code}`);
  assert.equal(decoded.spaceId, "abc123");
  assert.equal(decoded.kdf.iterations, 600_000);
  assert.equal(decoded.passphrase, undefined);
});

test("weak invites are rejected", () => {
  assert.throws(() => decodeInvite(encodeUnsafe(1_000)), (error) => error.code === "kdf");
});

test("encrypted export has no plaintext and plain export warns", async () => {
  const secrets = await createVaultSecrets("frase-prueba-01", "123456", weak);
  const profile = await encryptJson(secrets.dek, {
    nickA: "Persona A",
    nickB: "Persona B",
    autoLockMs: 120_000,
  }, PROFILE_AAD);
  const meta = buildMeta({ secrets, profile, createdAt: "2026-10-13T15:00:00.000Z" });
  const record = {
    id: "rec1",
    kind: "complaint",
    text: "texto-queja",
  };
  const packed = await encryptJson(secrets.dek, record, record.id);
  const exported = buildEncryptedExport({
    meta: {
      ...meta,
      kdf: {
        v: 2,
        name: "Argon2id",
        version: ARGON2.version,
        memory: ARGON2.memoryKiB,
        iterations: ARGON2.iterations,
        parallelism: 1,
        salt: meta.kdf.salt,
      },
    },
    records: [{ id: record.id, iv: packed.iv, ciphertext: packed.ciphertext }],
    audios: [],
    exportedAt: "2026-10-13T16:00:00.000Z",
  });
  const json = JSON.stringify(exported);
  assert.equal(exported.encrypted, true);
  assert.equal(exported.pin, undefined);
  assert.equal(json.includes("texto-queja"), false);
  assert.equal(json.includes("Persona A"), false);
  assert.equal(json.includes("Persona B"), false);
  assert.equal(json.includes("frase-prueba-01"), false);
  const parsed = parseEncryptedExport(json);
  assert.equal(parsed.records.length, 1);
  const plain = buildPlainExport({
    profile: { nickA: "Persona A" },
    records: [record],
    audios: [],
    exportedAt: "2026-10-13T16:00:00.000Z",
  });
  assert.equal(plain.encrypted, false);
  assert.equal(plain.warning, PLAIN_WARNING);
  assert.equal(plain.records[0].text, record.text);
  assert.throws(() => parseEncryptedExport(JSON.stringify(plain)), (error) => error.code === "backup-plain");
});

test("sync stub is off and only describes ciphertext", () => {
  assert.equal(SYNC.enabled, false);
  assert.equal(SYNC.endpoint, null);
  assert.equal(SYNC.storesPlaintext, false);
  assert.equal(SYNC.storesKeys, false);
  assert.deepEqual(ciphertextEnvelope({
    id: "a",
    iv: "bb",
    ciphertext: "cc",
    text: "secreto",
    passphrase: "no",
  }), { id: "a", iv: "bb", ciphertext: "cc" });
  assert.throws(() => pushCiphertext({ id: "a" }), /apagada/);
});

test("dictation notice and audio limit", () => {
  assert.match(DICTATION_NOTICE, /fabricante/i);
  assert.match(DICTATION_NOTICE, /no usamos/i);
  assert.equal(MAX_AUDIO_MS, 60_000);
});

function encodeUnsafe(iterations) {
  const payload = {
    v: 1,
    spaceId: "abc",
    createdAt: "2026-10-13T15:00:00.000Z",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: "c2FsdA==" },
    wrappedDek: { iv: "aXY=", wrapped: "d3JhcA==" },
    verifier: { iv: "aXY=", ciphertext: "Y2lwaA==" },
    profile: { iv: "aXY=", ciphertext: "Y2lwaA==" },
  };
  return `mp1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}
