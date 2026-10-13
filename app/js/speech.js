export const DICTATION_NOTICE =
  "En algunos navegadores el audio del dictado lo procesa el servicio del fabricante (por ejemplo el de Google o el de Apple), no Matripuntos. No usamos un servicio de transcripción aparte. Si eso no te cierra, escribe a mano.";

export function speechSupport() {
  const root = globalThis;
  return typeof root.SpeechRecognition === "function" || typeof root.webkitSpeechRecognition === "function";
}

export function startDictation({ lang = "es-CL", onText, onEnd, onError }) {
  const Ctor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    let text = "";
    for (let index = 0; index < event.results.length; index += 1) {
      text += event.results[index][0].transcript;
    }
    const last = event.results[event.results.length - 1];
    onText?.(text, Boolean(last?.isFinal));
  };
  recognition.onerror = (event) => onError?.(event?.error || "error");
  recognition.onend = () => onEnd?.();
  recognition.start();
  return recognition;
}
