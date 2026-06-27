import {
  DEFAULT_STREAM_OPTIONS,
  NVIDIA_CHAT_COMPLETIONS_URL,
} from "./config.js";

export async function createNvidiaChatCompletion({ apiKey, model, messages }) {
  if (!apiKey) {
    throw new Error("Missing NVIDIA_API_KEY. Set it with `wrangler secret put NVIDIA_API_KEY`.");
  }

  const response = await fetch(NVIDIA_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      ...DEFAULT_STREAM_OPTIONS,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`NVIDIA upstream error ${response.status}: ${errorText}`);
  }

  return response;
}
