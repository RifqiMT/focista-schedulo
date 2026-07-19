/**
 * Browser-local AI provider keys for Productivity Summary.
 * Never commit these; they stay in localStorage and are sent only to the app API.
 */

const AI_KEYS_STORAGE_KEY = "pst.aiKeys";
export const AI_KEYS_CHANGED_EVENT = "pst:ai-keys-changed";

export type AiKeys = {
  groqApiKey: string;
  tavilyApiKey: string;
};

const EMPTY: AiKeys = { groqApiKey: "", tavilyApiKey: "" };

function safeParse(raw: string | null): AiKeys {
  if (!raw) return { ...EMPTY };
  try {
    const data = JSON.parse(raw) as Partial<AiKeys>;
    return {
      groqApiKey: typeof data.groqApiKey === "string" ? data.groqApiKey.trim() : "",
      tavilyApiKey: typeof data.tavilyApiKey === "string" ? data.tavilyApiKey.trim() : ""
    };
  } catch {
    return { ...EMPTY };
  }
}

export function loadAiKeys(): AiKeys {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    return safeParse(window.localStorage.getItem(AI_KEYS_STORAGE_KEY));
  } catch {
    return { ...EMPTY };
  }
}

export function saveAiKeys(next: AiKeys): void {
  if (typeof window === "undefined") return;
  const cleaned: AiKeys = {
    groqApiKey: next.groqApiKey.trim(),
    tavilyApiKey: next.tavilyApiKey.trim()
  };
  try {
    if (!cleaned.groqApiKey && !cleaned.tavilyApiKey) {
      window.localStorage.removeItem(AI_KEYS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(AI_KEYS_STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch (err) {
    console.error("[aiKeys] Failed to persist keys locally", err);
    throw new Error("Could not save keys to local storage.");
  }
  window.dispatchEvent(new CustomEvent(AI_KEYS_CHANGED_EVENT, { detail: cleaned }));
}

export function clearAiKeys(): void {
  saveAiKeys({ ...EMPTY });
}

export function hasGroqKey(keys: AiKeys = loadAiKeys()): boolean {
  return keys.groqApiKey.length > 0;
}

export function hasAnyAiKey(keys: AiKeys = loadAiKeys()): boolean {
  return keys.groqApiKey.length > 0 || keys.tavilyApiKey.length > 0;
}

/** Payload fragment to attach to Productivity Summary API calls (omit empty). */
export function aiKeysRequestFields(keys: AiKeys = loadAiKeys()): {
  groqApiKey?: string;
  tavilyApiKey?: string;
} {
  const out: { groqApiKey?: string; tavilyApiKey?: string } = {};
  if (keys.groqApiKey) out.groqApiKey = keys.groqApiKey;
  if (keys.tavilyApiKey) out.tavilyApiKey = keys.tavilyApiKey;
  return out;
}

export type AiKeyProvider = "groq" | "tavily";

export type AiKeyCheckState = "idle" | "format" | "checking" | "valid" | "invalid";

export function looksLikeGroqKey(value: string): boolean {
  return /^gsk_[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export function looksLikeTavilyKey(value: string): boolean {
  return /^tvly[-_][A-Za-z0-9_-]{8,}$/i.test(value.trim());
}
