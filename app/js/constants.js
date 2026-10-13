export const DB_NAME = "matripuntos";
export const META_KEY = "main";

export const PROFILE_AAD = "matripuntos-profile";
export const VERIFIER_AAD = "matripuntos-verifier";

export const AUTOLOCK_DEFAULT_MS = 120_000;
export const AUTOLOCK_CHOICES = Object.freeze([
  { ms: 60_000, label: "1 minuto" },
  { ms: 120_000, label: "2 minutos" },
  { ms: 300_000, label: "5 minutos" },
]);

export const MAX_BACKUP_CHARS = 20_000_000;
export const MAX_RECORDS = 5_000;
export const MAX_AUDIOS = 400;
