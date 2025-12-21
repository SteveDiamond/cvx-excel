import { loadWasm } from "cvxjs";

let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Ensure WASM solver is loaded. Safe to call multiple times.
 */
export async function ensureSolverReady(): Promise<void> {
  if (wasmInitialized) {
    return;
  }

  if (wasmInitPromise) {
    return wasmInitPromise;
  }

  wasmInitPromise = loadWasm().then(() => {
    wasmInitialized = true;
  });

  return wasmInitPromise;
}

/**
 * Check if solver is ready (non-blocking)
 */
export function isSolverReady(): boolean {
  return wasmInitialized;
}
