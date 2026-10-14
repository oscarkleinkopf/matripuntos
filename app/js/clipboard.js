export const CLIPBOARD_CLEAR_MS = 45_000;

export const CLIPBOARD_WARNING =
  "Si copias un código de invitación o un respaldo, otra aplicación puede leer el portapapeles. Se intentará vaciarlo solo. Si el navegador no deja, bórralo a mano.";

export const CLIPBOARD_COPIED =
  "Copiado. En 45 segundos se intentará borrar el portapapeles. Otra aplicación puede leerlo antes. Si no se borra, límpialo a mano.";

export function planClipboardClear(now = Date.now()) {
  return { clearAt: now + CLIPBOARD_CLEAR_MS, waitMs: CLIPBOARD_CLEAR_MS };
}

export async function clearClipboardIfMatch(clipboard, secret) {
  let current;
  try {
    current = await clipboard.readText();
  } catch {
    return { cleared: false, reason: "unread" };
  }
  if (current !== secret) return { cleared: false, reason: "changed" };
  try {
    await clipboard.writeText("");
    return { cleared: true, reason: "cleared" };
  } catch {
    return { cleared: false, reason: "unwrite" };
  }
}
