import { DEFAULT_MODEL, DIRECT_RESPONSE_PROMPT, MODELS } from "./config.js";

export function getAllowedModels() {
  return MODELS.map(({ id, label }) => ({ id, label }));
}

export function resolveModel(modelId) {
  return MODELS.some((model) => model.id === modelId) ? modelId : DEFAULT_MODEL;
}

export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && typeof message === "object")
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content : "",
    }))
    .filter((message) => message.content.length > 0);
}

export function buildUnlimMessages({ messages, systemPrompt = "" } = {}) {
  const prompt = typeof systemPrompt === "string" && systemPrompt.trim()
    ? `${DIRECT_RESPONSE_PROMPT}\n\n${systemPrompt.trim()}`
    : DIRECT_RESPONSE_PROMPT;

  return [
    { role: "system", content: prompt },
    ...normalizeMessages(messages),
  ];
}
