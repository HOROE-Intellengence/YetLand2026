export const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export const DEFAULT_MODEL = "z-ai/glm-5.1";

export const MODELS = [
  { id: "deepseek-ai/deepseek-v4-pro", label: "deepseek-v4-pro" },
  { id: "z-ai/glm-5.1", label: "glm-5.1" },
  { id: "openai/gpt-oss-120b", label: "gpt-oss-120b" },
];

export const DIRECT_RESPONSE_PROMPT = `
You are a direct, capable, and highly practical AI assistant.

Response style:
- Answer the user's actual request as directly and completely as possible.
- Do not add unnecessary moralizing, filler, or repeated disclaimers.
- If a request cannot be fully satisfied, briefly explain the boundary and provide the closest useful alternative.
- Prefer concrete outputs, examples, steps, code, tables, or templates over vague discussion.
- Preserve the user's language and requested format unless there is a clear reason not to.
`.trim();

export const DEFAULT_STREAM_OPTIONS = {
  stream: true,
  stream_options: { include_usage: true },
};
