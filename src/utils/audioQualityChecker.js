const BLANK_WINDOW_MS = 100;
const BLANK_HOP_MS = 50;
const WAV_PATH = "/input.wav";

let wasmModulePromise = null;

const log = (msg, ...args) => console.log(`${msg}`, ...args);
const err = (msg, ...args) => console.error(`${msg}`, ...args);

// LOAD WASM SCRIPT
function loadScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      const poll = setInterval(() => {
        if (typeof window[globalName] === "function") {
          clearInterval(poll);
          resolve();
        }
      }, 50);

      return;
    }

    const script = document.createElement("script");

    script.src = src;

    script.onload = resolve;

    script.onerror = () => {
      err(`Failed to load script: ${src}`);
      reject(new Error(`Failed to load ${src}`));
    };

    document.body.appendChild(script);
  });
}

// INITIALIZE WASM
async function initializeWasm() {
  try {
    await loadScript("/audioQuality.js", "AudioQualityModule");

    log("Audio Quality glue script loaded, initializing WASM…");

    const mod = await window.AudioQualityModule();

    log("Audio Quality WASM module ready");

    return mod;
  } catch (e) {
    err("WASM initialization failed:", e);
    throw e;
  }
}

// GET WASM MODULE
function getWasmModule() {
  if (!wasmModulePromise) {
    wasmModulePromise = initializeWasm();
  }

  return wasmModulePromise;
}

// BLANK AUDIO CHECK
function checkBlank(mod, path) {
  const result = mod.ccall(
    "isBlankAudio",
    "number",
    ["string", "number", "number"],
    [path, BLANK_WINDOW_MS, BLANK_HOP_MS],
  );

  // log(`Blank check result: ${result}`);

  if (result === -1) return null;
  return result === 1;
}

// AUDIO QUALITY CHECK
export async function checkAudioQuality(audioBlob) {
  if (!audioBlob) {
    throw new Error("No audio blob provided");
  }

  const mod = await getWasmModule();

  log("Starting audio quality check");

  // MEDIA → WAV
  const arrayBuffer = await audioBlob.arrayBuffer();
  const inputBytes = new Uint8Array(arrayBuffer);

  const inputPtr = mod._malloc(inputBytes.length);
  mod.HEAPU8.set(inputBytes, inputPtr);

  const outSizePtr = mod._malloc(4);

  log("Decoding Media → WAV…");

  const wavPtr = mod._decodeMediaToWav(inputPtr, inputBytes.length, outSizePtr);

  const wavSize = mod.getValue(outSizePtr, "i32");

  // log(`Decode → wavSize: ${wavSize}`);

  if (wavPtr === 0 || wavSize === 0) {
    err("Decode failed: wavPtr or wavSize is 0");

    mod._free(inputPtr);
    mod._free(outSizePtr);

    throw new Error("Decode failed");
  }

  // Copy WAV bytes NOW before _freeBuffer releases wavPtr
  const wavBytes = new Uint8Array(mod.HEAPU8.buffer, wavPtr, wavSize).slice();

  mod._freeBuffer(wavPtr);
  mod._free(inputPtr);
  mod._free(outSizePtr);

  // BLANK AUDIO CHECK
  log("Checking for blank audio…");

  try {
    mod.FS.writeFile(WAV_PATH, wavBytes);
  } catch (e) {
    err("Failed to write WAV to WASM FS:", e);
    throw new Error("Filesystem write failed");
  }

  const isBlank = checkBlank(mod, WAV_PATH);

  if (isBlank === true) {
    const result = {
      status: -2,
      message: "Blank audio",
    };

    log("Blank audio response:", result);

    return result;
  }

  // SNR
  log("Computing SNR…");

  const jsonStr = mod.ccall("computeSNR", "string", ["string"], [WAV_PATH]);

  let data;

  try {
    data = JSON.parse(jsonStr);

    // log("Parsed SNR result:", data);
  } catch (e) {
    err("Failed to parse SNR JSON:", e, "Raw string:", jsonStr);
    throw new Error("SNR parse error");
  }

  return data;
}
