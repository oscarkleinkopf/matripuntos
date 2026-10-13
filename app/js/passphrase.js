import { MpError } from "./errors.js";
import { randomBytes } from "./bytes.js";
import { readPinnedBytes } from "./pinned-file.js";

// EFF long wordlist, English, CC BY 3.0. License: app/vendor/diceware/LICENSE.
// Suggestions are generated on the phone. Nothing is fetched for this list.
export const DICEWARE_SHA256 = "addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e";
export const DICEWARE_WORDS = 7776;
export const SUGGESTED_WORDS = 6;

let wordlistPromise = null;

export function parseDicewareList(text) {
  const words = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    const word = (tab >= 0 ? line.slice(tab + 1) : line).trim();
    if (!word) throw new MpError("wordlist", "La lista de palabras está dañada.");
    words.push(word);
  }
  if (words.length !== DICEWARE_WORDS || new Set(words).size !== DICEWARE_WORDS) {
    throw new MpError("wordlist", "La lista de palabras está dañada.");
  }
  return words;
}

async function loadWordlist() {
  if (!wordlistPromise) {
    wordlistPromise = (async () => {
      const bytes = await readPinnedBytes(new URL("../vendor/diceware/eff-large-wordlist.txt", import.meta.url), DICEWARE_SHA256);
      return parseDicewareList(new TextDecoder().decode(bytes));
    })().catch((error) => {
      wordlistPromise = null;
      throw error;
    });
  }
  return wordlistPromise;
}

function uniformIndex(modulo, bytesOf) {
  if (modulo <= 0) throw new MpError("wordlist", "La lista de palabras está dañada.");
  const limit = Math.floor(0x1_0000_0000 / modulo) * modulo;
  while (true) {
    const buf = bytesOf(4);
    const value = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0);
    if (value < limit) return value % modulo;
  }
}

export async function suggestPassphrase(count = SUGGESTED_WORDS, bytesOf = randomBytes) {
  const words = await loadWordlist();
  const chosen = [];
  for (let index = 0; index < count; index += 1) {
    chosen.push(words[uniformIndex(words.length, bytesOf)]);
  }
  return chosen.join(" ");
}
