/**
 * Local Ollama context for OpenClaw / platform primary.
 *
 * OpenClaw precheck: promptBudget = contextWindow - reserveTokens.
 * VPS logs (deepseek-r1:8b): estimatedPromptTokens≈19490, reserveTokens=20000,
 * so 32768 only leaves 12768 and overflows "hi". Need ≥19490+20000+headroom → 65536.
 * ollama show deepseek-r1:8b: context length 131072. Do not default to 128k on 16GB RAM.
 */
export const LOCAL_OLLAMA_PRIMARY_CTX_FLOOR = 65536;
export const LOCAL_OLLAMA_NATIVE_CTX_CAP = 131072;

export function resolveLocalOllamaContextWindow(envValue, nativeMax) {
  const parsed = Number(envValue);
  const fromEnv =
    Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : LOCAL_OLLAMA_PRIMARY_CTX_FLOOR;
  const capParsed = Number(nativeMax);
  const cap =
    Number.isFinite(capParsed) && capParsed > 0
      ? Math.floor(capParsed)
      : LOCAL_OLLAMA_NATIVE_CTX_CAP;
  return Math.min(cap, Math.max(LOCAL_OLLAMA_PRIMARY_CTX_FLOOR, fromEnv));
}
