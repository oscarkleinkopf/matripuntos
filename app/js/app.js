import { el } from "./dom.js";
import { MpError } from "./errors.js";
import {
  AUTOLOCK_CHOICES,
  AUTOLOCK_DEFAULT_MS,
  DB_NAME,
  MAX_BACKUP_CHARS,
  PROFILE_AAD,
} from "./constants.js";
import { bytesToB64, randomId, zeroize } from "./bytes.js";
import {
  assertPassphrase,
  assertPin,
  buildMeta,
  createVaultSecrets,
  encryptJson,
  normalizeSecret,
  unlockForRewrap,
  unlockWithPassphrase,
  unlockWithPin,
  wrapDekWithPin,
} from "./crypto.js";
import {
  CATEGORIES,
  applyComplaint,
  applyGesture,
  applySettlement,
  categoryLabel,
  formatPeriodLabel,
  otherPartner,
  scoreboard,
} from "./scoring.js";
import { pinGate, registerPinFailure, registerPinSuccess } from "./lock.js";
import { deleteEverything } from "./delete-all.js";
import { decodeInvite, encodeInvite, inviteLink } from "./invite.js";
import { buildEncryptedExport, buildPlainExport, parseEncryptedExport } from "./export.js";
import { DICTATION_NOTICE, speechSupport, startDictation } from "./speech.js";
import { MAX_AUDIO_MS, audioSupport, startRecording } from "./audio.js";
import { closeDatabase, getMeta, saveMeta } from "./idb.js";
import {
  collectCipherRows,
  loadAllAudio,
  loadAudio,
  openSpace,
  rotateVault,
  saveEntry,
  verifyAndCommitImport,
} from "./vault.js";

const state = {
  screen: "boot",
  meta: null,
  dek: null,
  profile: null,
  records: [],
  period: "week",
  historyFilter: "all",
  selectedId: null,
  returnTo: "home",
  pendingInvite: null,
  inviteError: "",
  audioDraft: null,
  recorder: null,
  recognition: null,
  audioUrls: [],
  lastActivity: 0,
  installEvent: null,
  rewrappable: null,
  toast: "",
  pinPress: null,
  busy: false,
};

function userMessage(error) {
  if (error instanceof MpError) return error.message;
  return "No se pudo completar. Los datos siguen en este teléfono.";
}

function setBusy(busy, label = "") {
  state.busy = busy;
  document.body.classList.toggle("is-busy", busy);
  const node = document.querySelector("#status");
  if (node) node.textContent = busy ? label : "";
}

let toastTimer = 0;

function paintToast() {
  const node = document.querySelector("#toast");
  if (!node) return;
  node.textContent = state.toast || "";
  clearTimeout(toastTimer);
  if (!state.toast) return;
  toastTimer = setTimeout(() => {
    state.toast = "";
    node.textContent = "";
  }, 4500);
}

function noteActivity() {
  if (!state.dek || state.busy) return;
  state.lastActivity = Date.now();
}

function nameOf(id) {
  if (id === "a") return state.profile?.nickA || "Yo";
  return state.profile?.nickB || "Mi pareja";
}

function cleanProfile(input = {}) {
  const nick = (value, fallback) => {
    const text = String(value ?? "").replace(/[\u0000-\u001F]/g, "").trim();
    if (!text) return fallback;
    return [...text].slice(0, 24).join("");
  };
  const allowed = new Set(AUTOLOCK_CHOICES.map((choice) => choice.ms));
  const autoLockMs = Number(input.autoLockMs);
  return {
    nickA: nick(input.nickA, "Yo"),
    nickB: nick(input.nickB, "Mi pareja"),
    autoLockMs: allowed.has(autoLockMs) ? autoLockMs : AUTOLOCK_DEFAULT_MS,
  };
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function formatPoints(points) {
  if (points > 0) return `+${points}`;
  return String(points);
}

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function waitLabel(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

function byNewest(records) {
  return [...records].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function page(parent, ...nodes) {
  parent.append(el("main", { class: "sheet" }, nodes));
}

function errorLine() {
  return el("p", { class: "error", "data-error": "1", role: "alert", hidden: true });
}

function showFormError(form, message) {
  const node = form.querySelector("[data-error]");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
}

function brand() {
  return el("div", { class: "mast" }, [
    el("img", { src: "/icons/icon.svg", width: "44", height: "44", alt: "" }),
    el("div", {}, [
      el("p", { class: "brand", text: "Matripuntos" }),
      el("p", { class: "quiet", text: "La cuenta de los dos" }),
    ]),
  ]);
}

function secretInput(id, autocomplete) {
  const input = el("input", {
    id,
    type: "password",
    autocomplete,
    spellcheck: "false",
    autocapitalize: "off",
    autocorrect: "off",
    required: true,
  });
  const toggle = el("button", { type: "button", class: "text-btn", text: "Mostrar" });
  toggle.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    toggle.textContent = hidden ? "Ocultar" : "Mostrar";
  });
  return { input, toggle };
}

function field(label, control, extra) {
  return el("label", { class: "field" }, [el("span", { text: label }), control, extra || null]);
}

function choiceGroup(name, legend, options, selected) {
  const wrap = el("fieldset", { class: "choices" }, [el("legend", { text: legend })]);
  options.forEach((option, index) => {
    wrap.append(
      el("label", { class: "chip" }, [
        el("input", {
          type: "radio",
          name,
          value: option.value,
          checked: option.value === selected,
          required: index === 0,
        }),
        option.label,
      ]),
    );
  });
  return wrap;
}

function stopDictation() {
  if (!state.recognition) return;
  try {
    state.recognition.onend = null;
    state.recognition.stop();
  } catch {
    /* ya estaba cerrado */
  }
  state.recognition = null;
}

async function cancelRecording() {
  const handle = state.recorder;
  state.recorder = null;
  if (handle) await handle.cancel();
}

function discardDraftAudio() {
  if (state.audioDraft?.bytes) zeroize(state.audioDraft.bytes);
  state.audioDraft = null;
}

function revokePlayback() {
  for (const url of state.audioUrls) URL.revokeObjectURL(url);
  state.audioUrls = [];
}

function leaveTo(screen, patch = {}) {
  stopDictation();
  void cancelRecording();
  discardDraftAudio();
  revokePlayback();
  const toast = patch.toast ?? "";
  Object.assign(state, patch);
  state.toast = toast;
  state.screen = screen;
  render();
}

function lockNow() {
  stopDictation();
  void cancelRecording();
  discardDraftAudio();
  revokePlayback();
  state.dek = null;
  state.rewrappable = null;
  state.records = [];
  state.profile = null;
  state.toast = "";
  state.screen = state.meta?.pin?.wrappedDek ? "lock" : "phrase";
  render();
}

async function enterSpace(dek) {
  const opened = await openSpace(dek, state.meta);
  state.dek = dek;
  state.profile = cleanProfile(opened.profile);
  state.records = opened.records;
  state.lastActivity = Date.now();
  state.screen = "home";
  render();
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function readHashInvite() {
  const hash = location.hash;
  if (!hash.startsWith("#mp1.")) return null;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  try {
    return decodeInvite(hash);
  } catch (error) {
    state.inviteError = userMessage(error);
    return null;
  }
}

function indexedDbAdapter() {
  return {
    deleteDatabase(name) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("blocked"));
      });
    },
  };
}

async function wipeDevice(form) {
  setBusy(true, "Borrando este teléfono…");
  try {
    await deleteEverything({
      dbName: DB_NAME,
      memory: state,
      closeDb: closeDatabase,
      indexedDB: indexedDbAdapter(),
      caches: globalThis.caches,
      serviceWorker: navigator.serviceWorker,
      localStorage: globalThis.localStorage,
      sessionStorage: globalThis.sessionStorage,
      revokeUrl: (url) => URL.revokeObjectURL(url),
    });
    location.replace(`${location.pathname}${location.search}`);
  } catch {
    setBusy(false);
    if (form) showFormError(form, "No se pudo borrar todo. Cierra las otras pestañas de Matripuntos y vuelve a intentar.");
  }
}

function renderBoot(root) {
  page(root, brand(), el("p", { text: "Abriendo el cuaderno…" }));
}

function renderWelcome(root) {
  const actions = [
    el("button", { class: "btn primary", type: "button", text: "Crear espacio", onclick: () => leaveTo("create") }),
    el("button", { class: "btn", type: "button", text: "Tengo una invitación", onclick: () => leaveTo("join") }),
    el("button", { class: "btn", type: "button", text: "Restaurar respaldo cifrado", onclick: () => leaveTo("restore") }),
  ];
  if (state.installEvent) {
    actions.push(el("button", { class: "btn", type: "button", text: "Instalar en el teléfono", onclick: () => installApp() }));
  }
  page(
    root,
    brand(),
    el("h1", { text: "La cuenta, pero saldada." }),
    el("p", { class: "lede", text: "Un cuaderno para una pareja: las quejas restan, una disculpa o un gesto las cierra, y los buenos gestos suman. Vive en este teléfono, cifrado. Sin cuentas, sin anuncios, sin servidor." }),
    el("div", { class: "stack" }, actions),
    el("p", { class: "footnote", text: "Juego entre ustedes, no un tribunal. Si solo se anota el enojo, se vuelve un libro de rencores." }),
  );
}

async function installApp() {
  if (!state.installEvent) return;
  await state.installEvent.prompt();
  state.installEvent = null;
  render();
}

function renderCreate(root) {
  const phrase = secretInput("phrase", "new-password");
  const again = secretInput("phrase2", "new-password");
  const pin = el("input", { id: "pin", inputmode: "numeric", autocomplete: "off", maxlength: "6", pattern: "[0-9]{6}", required: true });
  const pin2 = el("input", { id: "pin2", inputmode: "numeric", autocomplete: "off", maxlength: "6", pattern: "[0-9]{6}", required: true });
  const form = el("form", { class: "stack", autocomplete: "off" }, [
    errorLine(),
    field("Frase secreta", phrase.input, phrase.toggle),
    el("p", { class: "quiet", text: "Una frase larga que solo ustedes dos sepan. No la pongas en un chat. Si el navegador ofrece guardarla en una cuenta, esa copia sale del teléfono." }),
    field("Repite la frase", again.input, again.toggle),
    field("Tu nombre en el marcador", el("input", { id: "nickA", maxlength: "24", placeholder: "Yo", autocomplete: "off" })),
    field("El de tu pareja", el("input", { id: "nickB", maxlength: "24", placeholder: "Mi pareja", autocomplete: "off" })),
    el("p", { class: "quiet", text: "Son apodos, no hace falta el nombre real. Si invitas a tu pareja, verá estos mismos." }),
    field("PIN de este teléfono", pin),
    field("Repite el PIN", pin2),
    el("p", { class: "quiet", text: "Seis dígitos. Frena a quien toma el celular un momento. No alcanza si alguien copia los datos: para eso está la frase." }),
    el("button", { class: "btn primary", type: "submit", text: "Crear el espacio" }),
    el("button", { class: "btn", type: "button", text: "Volver", onclick: () => leaveTo("welcome") }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onCreate(form);
  });
  page(root, el("h1", { text: "Crear espacio" }), form);
}

async function onCreate(form) {
  const data = new FormData(form);
  showFormError(form, "");
  try {
    const phrase = assertPassphrase(form.querySelector("#phrase").value);
    if (phrase !== normalizeSecret(form.querySelector("#phrase2").value)) {
      throw new MpError("passphrase-match", "Las frases no coinciden.");
    }
    const pin = assertPin(form.querySelector("#pin").value);
    if (pin !== form.querySelector("#pin2").value.trim()) throw new MpError("pin", "Los PIN no coinciden.");
    if (await getMeta()) throw new MpError("exists", "En este teléfono ya hay un espacio.");
    setBusy(true, "Derivando la llave en este teléfono… puede tardar un poco.");
    const secrets = await createVaultSecrets(phrase, pin);
    const profile = cleanProfile({
      nickA: data.get("nickA") || form.querySelector("#nickA").value,
      nickB: form.querySelector("#nickB").value,
      autoLockMs: AUTOLOCK_DEFAULT_MS,
    });
    const profilePacked = await encryptJson(secrets.dek, profile, PROFILE_AAD);
    const meta = buildMeta({ secrets, profile: profilePacked, createdAt: new Date().toISOString() });
    await saveMeta(meta);
    form.reset();
    state.meta = meta;
    state.dek = secrets.dek;
    state.profile = profile;
    state.records = [];
    state.lastActivity = Date.now();
    state.toast = "Listo. La frase se la dices a tu pareja en persona. Desde Ajustes puedes invitarla.";
    state.screen = "home";
    render();
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderJoin(root) {
  const phrase = secretInput("phrase", "current-password");
  const nodes = [
    errorLine(),
    el("p", { class: "notice", text: "La invitación trae la llave del espacio, no las quejas. Este teléfono parte con el cuaderno vacío. Para copiar lo ya anotado, restauren un respaldo cifrado. La sincronización automática todavía no existe." }),
    el("p", { class: "notice", text: "El enlace usa el fragmento (#), que el navegador no envía al servidor. Igual puede quedar en el historial. No incluye la frase secreta: esa se dice en persona." }),
  ];
  if (!state.pendingInvite) {
    nodes.push(field("Código o enlace de invitación", el("textarea", { id: "code", required: true, spellcheck: "false", autocapitalize: "off" })));
  } else {
    nodes.push(el("p", { class: "quiet", text: "Invitación lista en este teléfono. Falta la frase secreta." }));
  }
  if (state.inviteError) nodes.push(el("p", { class: "error", text: state.inviteError }));
  nodes.push(
    field("Frase secreta", phrase.input, phrase.toggle),
    field("PIN de este teléfono", el("input", { id: "pin", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    field("Repite el PIN", el("input", { id: "pin2", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    el("button", { class: "btn primary", type: "submit", text: "Unirme" }),
    el("button", { class: "btn", type: "button", text: "Volver", onclick: () => leaveTo(state.meta ? "conflict" : "welcome") }),
  );
  const form = el("form", { class: "stack", autocomplete: "off" }, nodes);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onJoin(form);
  });
  page(root, el("h1", { text: "Unirme" }), form);
}

async function onJoin(form) {
  showFormError(form, "");
  try {
    if (await getMeta()) throw new MpError("exists", "Borra el espacio de este teléfono antes de unirte a otro.");
    const phrase = assertPassphrase(form.querySelector("#phrase").value);
    const pin = assertPin(form.querySelector("#pin").value);
    if (pin !== form.querySelector("#pin2").value.trim()) throw new MpError("pin", "Los PIN no coinciden.");
    const invite = state.pendingInvite || decodeInvite(form.querySelector("#code").value);
    setBusy(true, "Abriendo la invitación…");
    const opened = await unlockForRewrap(invite, phrase);
    const pinState = await wrapDekWithPin(opened.extractable, pin);
    const dek = opened.dek;
    const meta = {
      v: 1,
      spaceId: invite.spaceId,
      createdAt: invite.createdAt,
      kdf: invite.kdf,
      wrappedDek: invite.wrappedDek,
      verifier: invite.verifier,
      profile: invite.profile,
      pin: pinState,
    };
    await saveMeta(meta);
    form.reset();
    state.meta = meta;
    state.pendingInvite = null;
    state.toast = "La llave quedó en este teléfono. El cuaderno está vacío hasta que restauren un respaldo.";
    await enterSpace(dek);
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderRestore(root) {
  const phrase = secretInput("phrase", "current-password");
  const form = el("form", { class: "stack", autocomplete: "off" }, [
    errorLine(),
    el("p", { class: "quiet", text: "Elige el archivo del respaldo cifrado. Sin la frase no se puede leer, y aquí tampoco se manda a ningún servidor." }),
    field("Respaldo", el("input", { id: "file", type: "file", accept: "application/json,.json", required: true })),
    field("Frase secreta", phrase.input, phrase.toggle),
    field("PIN nuevo de este teléfono", el("input", { id: "pin", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    field("Repite el PIN", el("input", { id: "pin2", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    el("button", { class: "btn primary", type: "submit", text: "Restaurar" }),
    el("button", { class: "btn", type: "button", text: "Volver", onclick: () => leaveTo("welcome") }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onRestore(form);
  });
  page(root, el("h1", { text: "Restaurar" }), form);
}

async function onRestore(form) {
  showFormError(form, "");
  try {
    if (await getMeta()) throw new MpError("exists", "Borra el espacio de este teléfono antes de restaurar otro.");
    const file = form.querySelector("#file").files[0];
    if (!file) throw new MpError("backup", "Elige un archivo.");
    if (file.size > MAX_BACKUP_CHARS) throw new MpError("backup", "Ese archivo es demasiado grande.");
    const phrase = assertPassphrase(form.querySelector("#phrase").value);
    const pin = assertPin(form.querySelector("#pin").value);
    if (pin !== form.querySelector("#pin2").value.trim()) throw new MpError("pin", "Los PIN no coinciden.");
    setBusy(true, "Descifrando el respaldo en este teléfono…");
    const parsed = parseEncryptedExport(await file.text());
    const dek = await unlockWithPassphrase(parsed, phrase);
    const pinState = await wrapDekWithPin(dek, pin);
    const imported = await verifyAndCommitImport(dek, parsed, pinState);
    state.meta = imported.meta;
    state.toast = "Respaldo restaurado. El PIN nuevo es solo de este teléfono.";
    await enterSpace(dek);
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderConflict(root) {
  page(
    root,
    el("h1", { text: "Ya hay un espacio aquí" }),
    el("p", { text: "Este teléfono ya tiene un cuaderno. Unirte a otro lo reemplazaría. Si quieres hacerlo, primero borra todo en este dispositivo. Eso no borra el teléfono de tu pareja." }),
    el("div", { class: "stack" }, [
      el("button", { class: "btn", type: "button", text: "Volver al mío", onclick: () => leaveTo(state.meta?.pin?.wrappedDek ? "lock" : "phrase") }),
      el("button", { class: "btn danger", type: "button", text: "Borrar este teléfono", onclick: () => leaveTo("delete") }),
    ]),
  );
}

function renderPhrase(root) {
  const phrase = secretInput("phrase", "current-password");
  const form = el("form", { class: "stack", autocomplete: "off" }, [
    errorLine(),
    field("Frase secreta", phrase.input, phrase.toggle),
    el("button", { class: "btn primary", type: "submit", text: "Entrar" }),
    el("button", { class: "btn", type: "button", text: "Borrar todo de este teléfono", onclick: () => leaveTo("delete") }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onPhrase(form);
  });
  page(root, brand(), el("h1", { text: "Abrir con la frase" }), form);
}

async function onPhrase(form) {
  showFormError(form, "");
  try {
    const phrase = assertPassphrase(form.querySelector("#phrase").value);
    setBusy(true, "Abriendo…");
    const hadPin = Boolean(state.meta?.pin?.wrappedDek);
    form.reset();
    if (!hadPin) {
      const opened = await unlockForRewrap(state.meta, phrase);
      state.dek = opened.dek;
      state.rewrappable = opened.extractable;
      state.screen = "set-pin";
      render();
      return;
    }
    const dek = await unlockWithPassphrase(state.meta, phrase);
    await enterSpace(dek);
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderSetPin(root) {
  const form = el("form", { class: "stack" }, [
    errorLine(),
    el("p", { class: "quiet", text: "Elige un PIN nuevo para este teléfono. La frase secreta no cambia." }),
    field("PIN", el("input", { id: "pin", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    field("Repite el PIN", el("input", { id: "pin2", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    el("button", { class: "btn primary", type: "submit", text: "Guardar PIN" }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onSetPin(form);
  });
  page(root, el("h1", { text: "PIN de este teléfono" }), form);
}

async function onSetPin(form) {
  showFormError(form, "");
  try {
    const pin = assertPin(form.querySelector("#pin").value);
    if (pin !== form.querySelector("#pin2").value.trim()) throw new MpError("pin", "Los PIN no coinciden.");
    setBusy(true, "Guardando el PIN…");
    state.meta.pin = await wrapDekWithPin(state.rewrappable, pin);
    state.rewrappable = null;
    await saveMeta(state.meta);
    await enterSpace(state.dek);
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderLock(root) {
  let pin = "";
  const dots = el("p", { class: "pin-dots", "aria-live": "polite" });
  const error = errorLine();
  const paint = () => {
    dots.textContent = pin.length ? "●".repeat(pin.length) : "······";
    dots.setAttribute("aria-label", `${pin.length} de 6 dígitos`);
  };
  const paintError = (message) => {
    error.hidden = !message;
    error.textContent = message || "";
  };
  const press = (digit) => {
    if (state.busy) return;
    const gate = pinGate(state.meta.pin, Date.now());
    if (!gate.allow) {
      paintError(gate.reason === "locked" ? `Demasiados intentos. Espera ${waitLabel(gate.waitMs)}.` : "Usa la frase secreta.");
      return;
    }
    if (digit === "back") {
      pin = pin.slice(0, -1);
      paint();
      return;
    }
    if (pin.length >= 6) return;
    pin += digit;
    paint();
    if (pin.length === 6) {
      const attempt = pin;
      pin = "";
      paint();
      void submitPin(attempt, paintError);
    }
  };
  state.pinPress = press;
  paint();
  const gate = pinGate(state.meta.pin, Date.now());
  if (!gate.allow && gate.reason === "locked") paintError(`Demasiados intentos. Espera ${waitLabel(gate.waitMs)}.`);
  const grid = el("div", { class: "pad" });
  for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    grid.append(el("button", { type: "button", class: "key", text: digit, onclick: () => press(digit) }));
  }
  grid.append(el("span", { class: "key spacer" }));
  grid.append(el("button", { type: "button", class: "key", text: "0", onclick: () => press("0") }));
  grid.append(el("button", { type: "button", class: "key", text: "←", "aria-label": "Quitar dígito", onclick: () => press("back") }));
  page(
    root,
    brand(),
    el("h1", { text: "Está cerrado" }),
    el("p", { class: "quiet", text: "El PIN solo abre este teléfono." }),
    dots,
    error,
    grid,
    el("div", { class: "stack" }, [
      el("button", { class: "text-btn", type: "button", text: "Usar frase secreta", onclick: () => leaveTo("phrase") }),
      el("button", { class: "text-btn danger-text", type: "button", text: "Borrar todo de este teléfono", onclick: () => leaveTo("delete") }),
    ]),
  );
}

async function submitPin(pin, paintError) {
  if (state.busy) return;
  const gate = pinGate(state.meta.pin, Date.now());
  if (!gate.allow) {
    paintError(gate.reason === "locked" ? `Demasiados intentos. Espera ${waitLabel(gate.waitMs)}.` : "Usa la frase secreta.");
    return;
  }
  setBusy(true, "Revisando el PIN…");
  try {
    const dek = await unlockWithPin(state.meta, pin);
    state.meta.pin = registerPinSuccess(state.meta.pin);
    await saveMeta(state.meta);
    await enterSpace(dek);
  } catch (error) {
    if (error instanceof MpError && error.code === "pin-mismatch") {
      const next = registerPinFailure(state.meta.pin, Date.now());
      state.meta.pin = {
        kdf: next.kdf,
        wrappedDek: next.wrappedDek,
        failures: next.failures || 0,
        lockoutLevel: next.lockoutLevel || 0,
        lockedUntil: next.lockedUntil || 0,
      };
      await saveMeta(state.meta);
      if (next.wiped || !next.wrappedDek) {
        state.toast = "Se desactivó el PIN de este teléfono. Entra con la frase secreta y elige otro.";
        state.screen = "phrase";
        render();
        return;
      }
      paintError(next.reason === "lockout"
        ? `Demasiados intentos. Espera ${waitLabel(next.waitMs)}.`
        : `PIN incorrecto. Te quedan ${next.remaining}.`);
      return;
    }
    paintError(userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderHome(root) {
  const board = scoreboard(state.records, Date.now());
  const period = state.period === "month" ? board.month : board.week;
  const recent = state.records.filter((record) => {
    const time = Date.parse(record.createdAt);
    return record.kind !== "settlement" && time >= period.start && time < period.end;
  }).slice(0, 8);
  const list = recent.length
    ? el("div", { class: "list" }, recent.map((record) => recordRow(record, "home")))
    : el("p", { class: "empty", text: "Todavía no hay nada en este período. Si quieren, partan por un gesto." });
  page(
    root,
    el("header", { class: "mast" }, [
      el("img", { src: "/icons/icon.svg", width: "40", height: "40", alt: "" }),
      el("div", { class: "grow" }, [
        el("p", { class: "brand", text: "Matripuntos" }),
        el("p", { class: "quiet", text: "La cuenta de los dos" }),
      ]),
      el("button", { class: "text-btn", type: "button", text: "Ajustes", onclick: () => leaveTo("settings") }),
    ]),
    el("div", { class: "switch", role: "tablist" }, [
      periodButton("week", "Semana"),
      periodButton("month", "Mes"),
    ]),
    el("p", { class: "quiet center", text: formatPeriodLabel(period) }),
    el("div", { class: "scores" }, [
      scoreCard("a", period.scores.a),
      scoreCard("b", period.scores.b),
    ]),
    period.pending
      ? el("p", { class: "notice", text: `${period.pending} sin saldar. Una disculpa o un gesto devuelve esos puntos. Al cambiar la semana o el mes el marcador parte de cero; el historial queda.` })
      : el("p", { class: "quiet", text: "Nada pendiente en este período." }),
    list,
    el("button", { class: "text-btn", type: "button", text: "Ver historial", onclick: () => leaveTo("history") }),
    el("div", { class: "actions" }, [
      el("button", { class: "btn primary", type: "button", text: "Anotar queja", onclick: () => leaveTo("complaint") }),
      el("button", { class: "btn", type: "button", text: "Anotar gesto", onclick: () => leaveTo("gesture") }),
    ]),
    el("p", { class: "footnote", text: "Juego entre ustedes. Sin rankings, sin publicidad, sin nube." }),
  );
}

function periodButton(period, label) {
  return el("button", {
    type: "button",
    class: state.period === period ? "seg on" : "seg",
    text: label,
    onclick: () => {
      state.period = period;
      render();
    },
  });
}

function scoreCard(id, points) {
  const tone = points > 0 ? "pos" : points < 0 ? "neg" : "";
  return el("article", { class: `score ${tone}` }, [
    el("p", { class: "who", text: nameOf(id) }),
    el("p", { class: "num", text: formatPoints(points) }),
    el("p", { class: "hint", text: points > 0 ? "a favor" : points < 0 ? "en contra" : "en cero" }),
  ]);
}

function recordRow(record, from) {
  const settled = record.kind === "complaint" && record.settledBy;
  const label = record.kind === "gesture" ? "Gesto" : categoryLabel(record.category);
  const pill = record.kind === "gesture" ? `+${record.points}` : settled ? "saldada" : `−${record.points}`;
  const tone = record.kind === "gesture" || settled ? "pos" : "neg";
  return el("button", {
    type: "button",
    class: "row",
    onclick: () => leaveTo("detail", { selectedId: record.id, returnTo: from }),
  }, [
    el("span", {}, [
      el("span", { class: "row-title", text: label }),
      el("span", { class: "quiet", text: `${nameOf(record.authorId)} · ${formatWhen(record.createdAt)}` }),
    ]),
    el("span", { class: `pill ${tone}`, text: pill }),
  ]);
}

function renderHistory(root) {
  const filters = [
    ["all", "Todo"],
    ["open", "Sin saldar"],
    ["gestures", "Gestos"],
  ];
  const items = state.records.filter((record) => {
    if (record.kind === "settlement") return false;
    if (state.historyFilter === "open") return record.kind === "complaint" && !record.settledBy;
    if (state.historyFilter === "gestures") return record.kind === "gesture";
    return true;
  });
  page(
    root,
    el("button", { class: "text-btn", type: "button", text: "Volver", onclick: () => leaveTo("home") }),
    el("h1", { text: "Historial" }),
    el("p", { class: "quiet", text: "Lo de un período anterior no mueve el marcador de ahora. Igual se puede saldar, para cerrarlo." }),
    el("div", { class: "switch" }, filters.map(([id, label]) => el("button", {
      type: "button",
      class: state.historyFilter === id ? "seg on" : "seg",
      text: label,
      onclick: () => {
        state.historyFilter = id;
        render();
      },
    }))),
    items.length
      ? el("div", { class: "list" }, items.map((record) => recordRow(record, "history")))
      : el("p", { class: "empty", text: "Nada por aquí." }),
  );
}

function renderDetail(root) {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (!record || record.kind === "settlement") {
    leaveTo(state.returnTo || "home");
    return;
  }
  const settlement = record.settledBy ? state.records.find((item) => item.id === record.settledBy) : null;
  const body = [
    el("button", { class: "text-btn", type: "button", text: "Volver", onclick: () => leaveTo(state.returnTo || "home") }),
    el("h1", { text: record.kind === "gesture" ? "Gesto" : categoryLabel(record.category) }),
    el("p", { class: record.kind === "gesture" || record.settledBy ? "pill pos" : "pill neg", text: record.kind === "gesture" ? `+${record.points} para ${nameOf(record.authorId)}` : record.settledBy ? "Saldada" : `−${record.points} para ${nameOf(record.aboutId)}` }),
    el("p", { class: "quiet", text: `${formatWhen(record.createdAt)} · anota ${nameOf(record.authorId)}` }),
    el("p", { class: "prose", text: record.text }),
  ];
  if (record.audioId) {
    body.push(el("button", { class: "btn", type: "button", text: "Escuchar nota", onclick: (event) => void playNote(event.currentTarget, record.audioId) }));
    body.push(el("div", { "data-player": "1" }));
  }
  if (settlement) {
    body.push(el("h2", { text: settlement.mode === "disculpa" ? "Disculpa" : "Gesto que la cierra" }));
    body.push(el("p", { class: "prose", text: settlement.text }));
    body.push(el("p", { class: "quiet", text: `${nameOf(settlement.authorId)} · ${formatWhen(settlement.createdAt)}` }));
  }
  if (record.kind === "complaint" && !record.settledBy) {
    body.push(el("button", { class: "btn primary", type: "button", text: "Saldar", onclick: () => leaveTo("settle", { selectedId: record.id, returnTo: "detail" }) }));
  }
  page(root, ...body);
}

async function playNote(button, audioId) {
  button.disabled = true;
  try {
    const loaded = await loadAudio(state.dek, audioId);
    if (!loaded) throw new MpError("audio", "No está esa nota.");
    const blob = new Blob([loaded.bytes], { type: loaded.mime });
    zeroize(loaded.bytes);
    const url = URL.createObjectURL(blob);
    state.audioUrls.push(url);
    const slot = button.parentElement.querySelector("[data-player]");
    slot.replaceChildren(el("audio", { controls: true, src: url }));
  } catch (error) {
    button.disabled = false;
    button.textContent = userMessage(error);
  }
}

function renderCompose(root, kind) {
  const complaint = kind === "settle" ? state.records.find((item) => item.id === state.selectedId) : null;
  if (kind === "settle" && (!complaint || complaint.settledBy)) {
    leaveTo("home");
    return;
  }
  const titles = { complaint: "Anotar queja", gesture: "Anotar gesto", settle: "Saldar" };
  const form = el("form", { class: "stack" }, [
    errorLine(),
    kind === "complaint"
      ? el("p", { class: "notice", text: "Esto es un juego entre ustedes, no un tribunal. Máximo 3 quejas y 10 puntos por persona al día." })
      : null,
    kind === "gesture"
      ? el("p", { class: "quiet", text: "Un gesto bueno suma. También hay un techo diario, para que el marcador no se infle." })
      : null,
    kind === "settle"
      ? el("p", { class: "prose", text: complaint.text })
      : null,
    field("Texto", el("textarea", { id: "text", maxlength: "500", required: true, rows: "4" })),
  ]);
  if (speechSupport()) {
    form.append(el("p", { class: "notice", text: DICTATION_NOTICE }));
    form.append(el("button", { class: "btn", type: "button", "data-dictate": "1", text: "Dictar" }));
  } else {
    form.append(el("p", { class: "quiet", text: "El dictado no está en este navegador. Escribe nomás." }));
  }
  if (audioSupport()) {
    form.append(el("p", { class: "quiet", text: "Nota de voz cifrada con la misma llave. Máximo 60 segundos. Se borra con todo lo demás." }));
    form.append(el("div", { class: "rowline" }, [
      el("button", { class: "btn", type: "button", "data-record": "1", text: "Grabar nota" }),
      el("span", { "data-rec-time": "1", class: "quiet", text: formatClock(0) }),
    ]));
  }
  if (kind === "complaint") {
    form.append(choiceGroup("category", "Categoría", CATEGORIES.map((category) => ({ value: category.id, label: category.label })), "platos"));
    form.append(choiceGroup("author", "¿Quién anota?", partnerOptions(), "a"));
    form.append(choiceGroup("about", "¿Sobre quién?", partnerOptions(), "b"));
  } else if (kind === "gesture") {
    form.append(choiceGroup("author", "¿Quién hizo el gesto?", partnerOptions(), "a"));
  } else {
    form.append(choiceGroup("mode", "Cómo se cierra", [
      { value: "disculpa", label: "Disculpa" },
      { value: "gesto", label: "Gesto" },
    ], "disculpa"));
    form.append(choiceGroup("author", "¿Quién responde?", partnerOptions(), otherPartner(complaint.authorId)));
  }
  if (kind === "settle") {
    form.append(el("p", { class: "quiet", text: `Vuelven ${complaint.points} puntos. Si la queja es de otro período, el marcador de ahora no cambia: igual queda cerrada.` }));
  } else {
    form.append(choiceGroup("points", "Puntos", [1, 2, 3, 4, 5].map((points) => ({
      value: String(points),
      label: String(points),
    })), "1"));
  }
  form.append(el("button", { class: "btn primary", type: "submit", text: "Guardar" }));
  form.append(el("button", { class: "btn", type: "button", text: "Cancelar", onclick: () => leaveTo(kind === "settle" ? "detail" : "home") }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onCompose(form, kind, complaint);
  });
  const dictate = form.querySelector("[data-dictate]");
  if (dictate) {
    dictate.addEventListener("click", () => toggleDictation(form, dictate));
  }
  const record = form.querySelector("[data-record]");
  if (record) record.addEventListener("click", () => void toggleRecording(form, record));
  page(root, el("h1", { text: titles[kind] }), form);
}

function partnerOptions() {
  return [
    { value: "a", label: nameOf("a") },
    { value: "b", label: nameOf("b") },
  ];
}

function toggleDictation(form, button) {
  const textarea = form.querySelector("#text");
  if (state.recognition) {
    stopDictation();
    button.textContent = "Dictar";
    return;
  }
  const base = textarea.value.trim();
  button.textContent = "Detener dictado";
  state.recognition = startDictation({
    onText(text) {
      textarea.value = `${base} ${text}`.trim();
    },
    onEnd() {
      state.recognition = null;
      button.textContent = "Dictar";
    },
    onError(code) {
      state.recognition = null;
      button.textContent = "Dictar";
      if (code === "not-allowed") showFormError(form, "El navegador no dejó usar el micrófono para dictar.");
    },
  });
}

async function toggleRecording(form, button) {
  if (state.recorder) {
    button.disabled = true;
    state.recorder.stop();
    return;
  }
  if (state.audioDraft) {
    discardDraftAudio();
    button.textContent = "Grabar nota";
    const time = form.querySelector("[data-rec-time]");
    if (time) time.textContent = formatClock(0);
    return;
  }
  try {
    const handle = await startRecording((ms) => {
      const time = form.querySelector("[data-rec-time]");
      if (time) time.textContent = `${formatClock(ms)} / ${formatClock(MAX_AUDIO_MS)}`;
    });
    state.recorder = handle;
    button.textContent = "Detener";
    handle.done.then((recorded) => {
      if (state.recorder && state.recorder !== handle) return;
      state.recorder = null;
      button.disabled = false;
      if (!recorded) {
        button.textContent = "Grabar nota";
        return;
      }
      state.audioDraft = { id: randomId(), mime: recorded.mime, bytes: recorded.bytes };
      button.textContent = "Quitar nota";
    }).catch((error) => {
      state.recorder = null;
      button.disabled = false;
      button.textContent = "Grabar nota";
      showFormError(form, userMessage(error));
    });
  } catch (error) {
    showFormError(form, userMessage(error));
  }
}

async function onCompose(form, kind, complaint) {
  showFormError(form, "");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    if (state.recorder) state.recorder.stop();
    await new Promise((resolve) => setTimeout(resolve, state.recorder ? 50 : 0));
    if (state.recorder) {
      await state.recorder.done.catch(() => null);
    }
    const text = form.querySelector("#text").value;
    const authorId = form.querySelector('input[name="author"]:checked')?.value;
    const audio = state.audioDraft;
    let next;
    let saving = [];
    if (kind === "complaint") {
      const aboutId = form.querySelector('input[name="about"]:checked')?.value;
      const category = form.querySelector('input[name="category"]:checked')?.value;
      const points = Number(form.querySelector('input[name="points"]:checked')?.value);
      const id = randomId();
      next = applyComplaint(state.records, {
        id, authorId, aboutId, category, points, text, audioId: audio?.id || null,
      }, Date.now());
      saving = [next.find((record) => record.id === id)];
    } else if (kind === "gesture") {
      const points = Number(form.querySelector('input[name="points"]:checked')?.value);
      const id = randomId();
      next = applyGesture(state.records, { id, authorId, points, text, audioId: audio?.id || null }, Date.now());
      saving = [next.find((record) => record.id === id)];
    } else {
      const mode = form.querySelector('input[name="mode"]:checked')?.value;
      const id = randomId();
      next = applySettlement(state.records, {
        id, authorId, complaintId: complaint.id, mode, text, audioId: audio?.id || null,
      }, Date.now());
      saving = next.filter((record) => record.id === id || record.id === complaint.id);
    }
    setBusy(true, "Cifrando…");
    await saveEntry(state.dek, { records: saving, audio });
    if (audio?.bytes) zeroize(audio.bytes);
    state.audioDraft = null;
    state.records = byNewest(next);
    state.toast = kind === "complaint" ? "Quedó anotada." : kind === "gesture" ? "Gesto anotado." : "Quedó saldada.";
    state.screen = "home";
    render();
  } catch (error) {
    button.disabled = false;
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderSettings(root) {
  const form = el("form", { class: "stack" }, [
    errorLine(),
    field("Tu nombre en el marcador", el("input", { id: "nickA", maxlength: "24", value: state.profile.nickA })),
    field("El de tu pareja", el("input", { id: "nickB", maxlength: "24", value: state.profile.nickB })),
    el("label", { class: "field" }, [
      el("span", { text: "Cierre automático" }),
      el("select", { id: "lock" }, AUTOLOCK_CHOICES.map((choice) => el("option", {
        value: String(choice.ms),
        text: choice.label,
        selected: choice.ms === state.profile.autoLockMs,
      }))),
    ]),
    el("button", { class: "btn", type: "submit", text: "Guardar ajustes" }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onSettings(form);
  });
  const buttons = [
    el("button", { class: "btn", type: "button", text: "Invitar a tu pareja", onclick: () => leaveTo("invite") }),
    el("button", { class: "btn", type: "button", text: "Cambiar frase secreta", onclick: () => leaveTo("rotate") }),
    el("button", { class: "btn", type: "button", text: "Exportar cifrado", onclick: () => void onEncryptedExport(root) }),
    el("button", { class: "btn", type: "button", text: "Exportar en claro", onclick: () => leaveTo("plain") }),
    el("button", { class: "btn", type: "button", text: "Bloquear ahora", onclick: () => lockNow() }),
    el("button", { class: "btn danger", type: "button", text: "Borrar todo", onclick: () => leaveTo("delete") }),
  ];
  if (state.installEvent) buttons.unshift(el("button", { class: "btn", type: "button", text: "Instalar", onclick: () => installApp() }));
  page(
    root,
    el("button", { class: "text-btn", type: "button", text: "Volver", onclick: () => leaveTo("home") }),
    el("h1", { text: "Ajustes" }),
    form,
    el("div", { class: "stack", id: "export-slot" }, buttons),
    el("h2", { text: "Cómo se protege" }),
    el("p", { class: "quiet", text: "Los datos se cifran en este teléfono antes de guardarse. La frase deriva la llave. El PIN solo envuelve esa llave aquí y se bloquea si fallas varias veces. No hay analítica ni servidores. Un respaldo cifrado sigue siendo ilegible sin la frase; uno en claro no." }),
  );
}

async function onSettings(form) {
  showFormError(form, "");
  try {
    const profile = cleanProfile({
      nickA: form.querySelector("#nickA").value,
      nickB: form.querySelector("#nickB").value,
      autoLockMs: Number(form.querySelector("#lock").value),
    });
    setBusy(true, "Guardando…");
    state.meta.profile = await encryptJson(state.dek, profile, PROFILE_AAD);
    state.profile = profile;
    await saveMeta(state.meta);
    state.toast = "Ajustes guardados.";
    render();
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

async function onEncryptedExport() {
  setBusy(true, "Armando el respaldo cifrado…");
  try {
    const rows = await collectCipherRows();
    const exported = buildEncryptedExport({
      meta: state.meta,
      records: rows.records,
      audios: rows.audios,
      exportedAt: new Date().toISOString(),
    });
    downloadJson("matripuntos-respaldo.json", exported);
    state.toast = "Respaldo cifrado listo. Sin la frase no se lee.";
    paintToast();
  } catch (error) {
    state.toast = userMessage(error);
    paintToast();
  } finally {
    setBusy(false);
  }
}

function renderInvite(root) {
  let code = "";
  let link = "";
  let failure = "";
  try {
    code = encodeInvite(state.meta);
    link = inviteLink(code, location.origin);
  } catch (error) {
    failure = userMessage(error);
  }
  const codeBox = el("textarea", { class: "codebox", readonly: true, spellcheck: "false", text: code });
  page(
    root,
    el("button", { class: "text-btn", type: "button", text: "Volver", onclick: () => leaveTo("settings") }),
    el("h1", { text: "Invitar" }),
    el("p", { class: "notice", text: "Este código lleva la llave envuelta y los apodos cifrados, no la frase y no las quejas. El enlace usa el fragmento (#): el navegador no lo manda al servidor, pero puede quedar en el historial del celular y en el chat donde lo pegues. Díganse la frase en persona, por otro canal, y borren el mensaje después." }),
    el("p", { class: "quiet", text: "El portapapeles lo pueden ver otras aplicaciones. Si lo copias, pégalo y luego límpialo." }),
    failure ? el("p", { class: "error", text: failure }) : null,
    codeBox,
    el("div", { class: "stack" }, [
      el("button", { class: "btn", type: "button", text: "Copiar código", onclick: () => copyText(code) }),
      el("button", { class: "btn", type: "button", text: "Copiar enlace", onclick: () => copyText(link) }),
      typeof navigator.share === "function"
        ? el("button", { class: "btn", type: "button", text: "Compartir enlace", onclick: () => shareLink(link) })
        : null,
    ]),
  );
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    state.toast = "Copiado. Bórralo del chat cuando tu pareja lo tenga.";
  } catch {
    state.toast = "No pude copiar solo. Selecciona el código y cópialo a mano.";
  }
  paintToast();
}

async function shareLink(link) {
  try {
    await navigator.share({ title: "Matripuntos", text: "Invitación. La frase va por otro lado.", url: link });
  } catch {
    /* la persona canceló */
  }
}

function renderRotate(root) {
  const current = secretInput("current", "current-password");
  const next = secretInput("next", "new-password");
  const again = secretInput("next2", "new-password");
  const form = el("form", { class: "stack" }, [
    errorLine(),
    el("p", { class: "notice", text: "Cambiar la frase vuelve a cifrar todo en este teléfono. Las invitaciones y los respaldos viejos dejan de servir. El otro teléfono no se entera solo." }),
    field("Frase actual", current.input, current.toggle),
    field("Frase nueva", next.input, next.toggle),
    field("Repite la frase nueva", again.input, again.toggle),
    field("PIN nuevo de este teléfono", el("input", { id: "pin", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    field("Repite el PIN", el("input", { id: "pin2", inputmode: "numeric", maxlength: "6", autocomplete: "off", required: true })),
    el("button", { class: "btn primary", type: "submit", text: "Cambiar frase" }),
    el("button", { class: "btn", type: "button", text: "Volver", onclick: () => leaveTo("settings") }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onRotate(form);
  });
  page(root, el("h1", { text: "Cambiar frase" }), form);
}

async function onRotate(form) {
  showFormError(form, "");
  try {
    const current = assertPassphrase(form.querySelector("#current").value);
    const next = assertPassphrase(form.querySelector("#next").value);
    if (next !== normalizeSecret(form.querySelector("#next2").value)) throw new MpError("passphrase-match", "Las frases nuevas no coinciden.");
    const pin = assertPin(form.querySelector("#pin").value);
    if (pin !== form.querySelector("#pin2").value.trim()) throw new MpError("pin", "Los PIN no coinciden.");
    setBusy(true, "Comprobando la frase y cifrando de nuevo…");
    await unlockWithPassphrase(state.meta, current);
    const created = await createVaultSecrets(next, pin);
    const audios = await loadAllAudio(state.dek);
    const nextMeta = await rotateVault({
      meta: state.meta,
      records: state.records,
      audios,
      created,
      profile: state.profile,
    });
    state.meta = nextMeta;
    state.dek = created.dek;
    form.reset();
    state.toast = "Frase nueva lista. Los respaldos viejos ya no abren.";
    state.screen = "home";
    render();
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderPlain(root) {
  const form = el("form", { class: "stack" }, [
    errorLine(),
    el("p", { class: "warning", text: "Este archivo se lee en claro. Cualquiera que lo abra ve las quejas, los gestos y los audios. No lo subas a la nube ni lo mandes por chat. Si solo quieres un respaldo, vuelve y usa la exportación cifrada." }),
    field("Escribe ENTIENDO", el("input", { id: "confirm", autocomplete: "off", spellcheck: "false", required: true })),
    el("button", { class: "btn danger", type: "submit", text: "Descargar en claro" }),
    el("button", { class: "btn", type: "button", text: "Volver", onclick: () => leaveTo("settings") }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onPlain(form);
  });
  page(root, el("h1", { text: "Exportar en claro" }), form);
}

async function onPlain(form) {
  showFormError(form, "");
  if (form.querySelector("#confirm").value.trim() !== "ENTIENDO") {
    showFormError(form, "Escribe ENTIENDO para confirmar.");
    return;
  }
  setBusy(true, "Preparando el archivo en claro…");
  try {
    const audios = await loadAllAudio(state.dek);
    const exported = buildPlainExport({
      profile: state.profile,
      records: state.records,
      audios: audios.map((audio) => ({ id: audio.id, mime: audio.mime, base64: bytesToB64(audio.bytes) })),
      exportedAt: new Date().toISOString(),
    });
    for (const audio of audios) zeroize(audio.bytes);
    downloadJson("matripuntos-claro.json", exported);
    state.toast = "Archivo en claro descargado. Cuídalo.";
    paintToast();
  } catch (error) {
    showFormError(form, userMessage(error));
  } finally {
    setBusy(false);
  }
}

function renderDelete(root) {
  const form = el("form", { class: "stack" }, [
    errorLine(),
    el("p", { class: "warning", text: "Esto borra el espacio en este dispositivo: quejas, gestos, audios, la frase guardada, el caché y el service worker. No se puede deshacer. Si tu pareja tiene otra copia, la de ella no se borra." }),
    field("Escribe BORRAR", el("input", { id: "confirm", autocomplete: "off", spellcheck: "false", required: true })),
    el("button", { class: "btn danger", type: "submit", text: "Borrar todo" }),
    el("button", {
      class: "btn",
      type: "button",
      text: "Cancelar",
      onclick: () => leaveTo(state.dek ? "settings" : state.meta?.pin?.wrappedDek ? "lock" : state.meta ? "phrase" : "welcome"),
    }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.querySelector("#confirm").value.trim() !== "BORRAR") {
      showFormError(form, "Escribe BORRAR para confirmar.");
      return;
    }
    void wipeDevice(form);
  });
  page(root, el("h1", { text: "Borrar todo" }), form);
}

const VIEWS = {
  boot: renderBoot,
  welcome: renderWelcome,
  create: renderCreate,
  join: renderJoin,
  restore: renderRestore,
  conflict: renderConflict,
  phrase: renderPhrase,
  "set-pin": renderSetPin,
  lock: renderLock,
  home: renderHome,
  history: renderHistory,
  detail: renderDetail,
  complaint: (root) => renderCompose(root, "complaint"),
  gesture: (root) => renderCompose(root, "gesture"),
  settle: (root) => renderCompose(root, "settle"),
  settings: renderSettings,
  invite: renderInvite,
  rotate: renderRotate,
  plain: renderPlain,
  delete: renderDelete,
};

function render() {
  state.pinPress = null;
  const root = document.querySelector("#app");
  root.replaceChildren();
  (VIEWS[state.screen] || renderWelcome)(root);
  paintToast();
}

function armLock() {
  setInterval(() => {
    if (!state.dek || !state.profile || state.busy) return;
    if (Date.now() - state.lastActivity >= state.profile.autoLockMs) lockNow();
  }, 4000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!state.dek || !state.profile || state.busy) return;
    if (Date.now() - state.lastActivity >= state.profile.autoLockMs) lockNow();
  });
  document.addEventListener("pointerdown", noteActivity);
  document.addEventListener("keydown", (event) => {
    noteActivity();
    if (state.screen !== "lock" || !state.pinPress) return;
    if (/^\d$/.test(event.key)) state.pinPress(event.key);
    else if (event.key === "Backspace") {
      event.preventDefault();
      state.pinPress("back");
    }
  });
}

async function boot() {
  state.pendingInvite = readHashInvite();
  try {
    state.meta = await getMeta();
  } catch {
    state.meta = null;
    state.toast = "No pude leer el espacio de este teléfono.";
  }
  if (state.pendingInvite && state.meta) state.screen = "conflict";
  else if (state.pendingInvite || state.inviteError) state.screen = "join";
  else if (state.meta?.pin?.wrappedDek) state.screen = "lock";
  else if (state.meta) state.screen = "phrase";
  else state.screen = "welcome";
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installEvent = event;
  if (state.screen === "welcome" || state.screen === "settings") render();
});

armLock();
void boot();
