import assert from "node:assert/strict";
import { test } from "node:test";
import { DB_NAME } from "../app/js/constants.js";
import { deleteEverything } from "../app/js/delete-all.js";

test("delete-all wipes memory, database, caches and service worker", async () => {
  const memory = {
    dek: { secret: true },
    records: [{ id: "1" }],
    profile: { nickA: "Persona A" },
    meta: { spaceId: "abc" },
    audioDraft: { id: "aud" },
    pendingInvite: { v: 1 },
    audioUrls: ["blob:nota"],
  };
  const deletedCaches = [];
  const unregistered = [];
  const local = { cleared: false, clear() { this.cleared = true; } };
  const session = { cleared: false, clear() { this.cleared = true; } };
  let closed = false;
  let dbName = "";
  const revoked = [];
  const result = await deleteEverything({
    memory,
    closeDb: async () => { closed = true; },
    indexedDB: { deleteDatabase: async (name) => { dbName = name; } },
    caches: {
      keys: async () => ["matripuntos-shell-v1", "otra"],
      delete: async (key) => { deletedCaches.push(key); return true; },
    },
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => { unregistered.push("a"); return true; } },
        { unregister: async () => { unregistered.push("b"); return true; } },
      ],
    },
    localStorage: local,
    sessionStorage: session,
    revokeUrl: (url) => revoked.push(url),
  });
  assert.deepEqual(result, { wiped: true });
  assert.equal(memory.dek, null);
  assert.deepEqual(memory.records, []);
  assert.equal(memory.profile, null);
  assert.equal(memory.meta, null);
  assert.equal(memory.audioDraft, null);
  assert.equal(memory.pendingInvite, null);
  assert.deepEqual(memory.audioUrls, []);
  assert.deepEqual(revoked, ["blob:nota"]);
  assert.equal(closed, true);
  assert.equal(dbName, DB_NAME);
  assert.deepEqual(deletedCaches, ["matripuntos-shell-v1", "otra"]);
  assert.deepEqual(unregistered, ["a", "b"]);
  assert.equal(local.cleared, true);
  assert.equal(session.cleared, true);
});

test("delete-all still attempts every store and reports an incomplete wipe", async () => {
  let cachesDeleted = false;
  await assert.rejects(() => deleteEverything({
    memory: { dek: 1, records: [1], profile: 1, meta: 1 },
    indexedDB: { deleteDatabase: async () => { throw new Error("db"); } },
    caches: {
      keys: async () => ["shell"],
      delete: async () => { cachesDeleted = true; return true; },
    },
    serviceWorker: { getRegistrations: async () => [] },
  }), (error) => error.message === "delete-incomplete");
  assert.equal(cachesDeleted, true);
});
