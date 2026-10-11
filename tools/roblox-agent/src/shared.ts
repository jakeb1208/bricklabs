export const DEFAULT_MODEL = "gemini-2.5-flash";
export const MAX_CHAT_TURNS = 20;
export const MAX_TOOL_ROUNDS = 8;
export const MAX_MESSAGE_LENGTH = 8_000;

export type GeminiContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};

export type GeminiGenerateRequest = {
  contents: GeminiContent[];
  tools?: Array<Record<string, unknown>>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
};

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getApiBaseUrl(): string {
  const raw = process.env["AGENT_API_URL"]?.trim();
  if (!raw) {
    throw new Error("Set AGENT_API_URL to your deployed Railway service URL.");
  }
  return raw.replace(/\/+$/, "");
}
