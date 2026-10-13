import setupWasm from "../vendor/argon2id/setup.js";
import { MpError } from "./errors.js";
import { readPinnedBytes } from "./pinned-file.js";

// Pins for the vendored argon2id 1.0.1 module. Changing a binary or the glue
// without updating these values makes derivation fail closed.
export const ARGON2_PINS = Object.freeze({
  "simd.wasm": "50647e10fc8e0adba4f60726f3f0d77db0e3c73516b05a83ad10390b3a8b4b0e",
  "no-simd.wasm": "1f16d8de5a6d8a3a4fad5885c4784f57713d3626fd7d55f852fd79ecadbc4f8e",
  "argon2id.js": "d665b8b099228d03c2ccc43800218bcf44a26d34eb9c7e1137c1efb8cd80d80a",
  "blake2b.js": "f45eff8a14acb9901b6039a3b177c15c9437fbfd3d258f571adc195ec350cc34",
  "setup.js": "a5f0ed495e7b810ffc3629146d280e69c2ff40bab9e7881ad9a92629c4b4d047",
});

let computePromise = null;
let chain = Promise.resolve();

function exclusive(task) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
}

async function loadCompute() {
  if (!computePromise) {
    computePromise = (async () => {
      const simd = await readPinnedBytes(new URL("../vendor/argon2id/simd.wasm", import.meta.url), ARGON2_PINS["simd.wasm"]);
      const plain = await readPinnedBytes(new URL("../vendor/argon2id/no-simd.wasm", import.meta.url), ARGON2_PINS["no-simd.wasm"]);
      try {
        return await setupWasm(
          (importObject) => WebAssembly.instantiate(simd, importObject),
          (importObject) => WebAssembly.instantiate(plain, importObject),
        );
      } catch {
        throw new MpError("kdf", "No se pudo preparar Argon2id en este teléfono.");
      }
    })().catch((error) => {
      computePromise = null;
      throw error;
    });
  }
  return computePromise;
}

export async function hashArgon2id(params) {
  return exclusive(async () => {
    const compute = await loadCompute();
    try {
      return compute(params);
    } catch (error) {
      if (error instanceof MpError) throw error;
      throw new MpError("kdf", "No se pudo derivar la llave en este teléfono.");
    }
  });
}
