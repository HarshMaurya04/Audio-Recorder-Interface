let wasmModulePromise = null;

// const log = (msg, ...args) => console.log(`${msg}`, ...args);
const err = (msg, ...args) => console.error(`${msg}`, ...args);

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

async function initializeWasm() {
  try {
    await loadScript(
      `${import.meta.env.BASE_URL}audioQuality.js`,
      "AudioQualityModule",
    );

    const mod = await window.AudioQualityModule();

    return mod;
  } catch (e) {
    err("WASM initialization failed:", e);
    throw e;
  }
}

function getWasmModule() {
  if (!wasmModulePromise) {
    wasmModulePromise = initializeWasm();
  }

  return wasmModulePromise;
}

export async function checkAudioQuality(audioBlob) {
  if (!audioBlob) {
    throw new Error("No audio blob provided");
  }

  const mod = await getWasmModule();

  let inputPtr = 0;

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const inputBytes = new Uint8Array(arrayBuffer);

    inputPtr = mod._malloc(inputBytes.length);

    if (!inputPtr) {
      throw new Error("Failed to allocate WASM memory for audio input");
    }

    mod.HEAPU8.set(inputBytes, inputPtr);

    const jsonStr = mod.ccall(
      "checkAudioQualityWasm",
      "string",
      ["number", "number"],
      [inputPtr, inputBytes.length],
    );

    let data;

    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      err("Failed to parse audio quality JSON:", e);
      err("Raw response:", jsonStr);
      throw new Error("Audio quality response parse error");
    }

    return data;
  } catch (e) {
    err("Audio quality check failed:", e);
    throw e;
  } finally {
    if (inputPtr) {
      mod._free(inputPtr);
    }
  }
}
