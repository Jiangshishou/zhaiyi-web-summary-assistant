export interface DeepSeekPowChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  difficulty: number;
  expire_at: number;
  signature: string;
  target_path: string;
}

let wasmInstance: WebAssembly.Instance | undefined;

async function loadWasm(): Promise<WebAssembly.Instance> {
  if (wasmInstance) return wasmInstance;
  const url = chrome.runtime.getURL("assets/sha3_wasm_bg.wasm");
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
  const instance = await WebAssembly.instantiate(module, {});
  wasmInstance = instance;
  return instance;
}

function writeStr(instance: WebAssembly.Instance, str: string): { ptr: number; len: number } {
  const memory = instance.exports.memory as WebAssembly.Memory;
  const malloc = instance.exports.__wbindgen_export_0 as (size: number, align: number) => number;
  const encoded = new TextEncoder().encode(str);
  const ptr = malloc(encoded.length, 1);
  const view = new Uint8Array(memory.buffer);
  for (let i = 0; i < encoded.length; i++) {
    view[ptr + i] = encoded[i];
  }
  return { ptr, len: encoded.length };
}

export async function solveDeepSeekPow(challenge: DeepSeekPowChallenge): Promise<string> {
  const instance = await loadWasm();
  const prefix = `${challenge.salt}_${challenge.expire_at}_`;

  const addToStack = instance.exports.__wbindgen_add_to_stack_pointer as (delta: number) => number;
  const wasmSolve = instance.exports.wasm_solve as (
    retptr: number, chPtr: number, chLen: number, pfxPtr: number, pfxLen: number, difficulty: number
  ) => void;

  const retptr = addToStack(-16);
  let chInfo: { ptr: number; len: number } | undefined;
  let pfxInfo: { ptr: number; len: number } | undefined;
  try {
    chInfo = writeStr(instance, challenge.challenge);
    pfxInfo = writeStr(instance, prefix);
    wasmSolve(retptr, chInfo.ptr, chInfo.len, pfxInfo.ptr, pfxInfo.len, challenge.difficulty);

    const view = new Int32Array((instance.exports.memory as WebAssembly.Memory).buffer);
    const status = view[retptr / 4];

    if (status === 0) {
      throw new Error("PoW WASM 求解失败：未找到答案");
    }

    const floatView = new Float64Array((instance.exports.memory as WebAssembly.Memory).buffer);
    const value = floatView[(retptr + 8) / 8];
    const answer = Math.floor(value);

    const result = {
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path
    };
    return btoa(JSON.stringify(result));
  } finally {
    addToStack(16);
    // ponytail: wasmFree (__wbindgen_export_1) triggers WASM unreachable trap on some builds.
    // Memory is reclaimed on WASM instance teardown; per-call leak is negligible (a few hundred bytes).
  }
}
