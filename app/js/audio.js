import { MpError } from "./errors.js";

export const MAX_AUDIO_MS = 60_000;
export const MAX_AUDIO_BYTES = 1_500_000;

export function audioSupport() {
  return typeof globalThis.MediaRecorder === "function" && typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function";
}

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export async function startRecording(onTick) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    if (error?.name === "NotAllowedError") {
      throw new MpError("mic", "No diste permiso para el micrófono. Puedes escribir igual.");
    }
    throw new MpError("audio", "No se pudo usar el micrófono.");
  }

  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  let cancelled = false;
  let timer = 0;
  const started = Date.now();

  const done = new Promise((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (!cancelled && event.data && event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      reject(new MpError("audio", "No se pudo grabar."));
    });
    recorder.addEventListener("stop", async () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      if (cancelled) {
        resolve(null);
        return;
      }
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.byteLength > MAX_AUDIO_BYTES) {
          reject(new MpError("audio-big", "El audio quedó demasiado pesado. Graba menos de un minuto."));
          return;
        }
        resolve({ mime: blob.type || "audio/webm", bytes });
      } catch {
        reject(new MpError("audio", "No se pudo guardar la nota de voz."));
      }
    });
  });

  recorder.start();
  timer = setInterval(() => {
    const elapsed = Date.now() - started;
    onTick?.(Math.min(elapsed, MAX_AUDIO_MS));
    if (elapsed >= MAX_AUDIO_MS && recorder.state === "recording") recorder.stop();
  }, 200);

  return {
    done,
    stop() {
      if (recorder.state === "recording") recorder.stop();
      return done;
    },
    cancel() {
      cancelled = true;
      chunks.length = 0;
      if (recorder.state === "recording") recorder.stop();
      else stream.getTracks().forEach((track) => track.stop());
      return done.catch(() => null);
    },
  };
}
