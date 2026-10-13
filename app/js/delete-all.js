import { DB_NAME } from "./constants.js";

export async function deleteEverything(env) {
  const errors = [];
  const run = async (fn) => {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
    }
  };

  await run(async () => {
    const memory = env.memory;
    if (!memory) return;
    memory.dek = null;
    memory.records = [];
    memory.profile = null;
    memory.meta = null;
    memory.audioDraft = null;
    memory.pendingInvite = null;
    if (Array.isArray(memory.audioUrls) && env.revokeUrl) {
      for (const url of memory.audioUrls) env.revokeUrl(url);
      memory.audioUrls = [];
    }
  });

  await run(() => env.closeDb?.());
  await run(() => env.indexedDB.deleteDatabase(env.dbName || DB_NAME));

  await run(async () => {
    if (!env.caches) return;
    const keys = await env.caches.keys();
    for (const key of keys) await env.caches.delete(key);
  });

  await run(async () => {
    if (!env.serviceWorker?.getRegistrations) return;
    const registrations = await env.serviceWorker.getRegistrations();
    for (const registration of registrations) await registration.unregister();
  });

  await run(() => {
    env.localStorage?.clear?.();
  });
  await run(() => {
    env.sessionStorage?.clear?.();
  });

  if (errors.length) {
    const error = new Error("delete-incomplete");
    error.errors = errors;
    throw error;
  }
  return { wiped: true };
}
