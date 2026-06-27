import { DEFAULT_MODEL } from "./config.js";
import { createNvidiaChatCompletion } from "./nvidia.js";
import { buildUnlimMessages, getAllowedModels, resolveModel } from "./unlim.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function response(body, contentType = "application/json; charset=utf-8", status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      ...extraHeaders,
    },
  });
}

function json(data, status = 200) {
  return response(JSON.stringify(data, null, 2), "application/json; charset=utf-8", status);
}

async function handleChat(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }

  const model = resolveModel(payload?.model);
  const messages = buildUnlimMessages({
    messages: payload?.messages,
    systemPrompt: payload?.system_prompt,
  });

  try {
    const upstream = await createNvidiaChatCompletion({
      apiKey: env.NVIDIA_API_KEY,
      model,
      messages,
    });

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return json({ error: error.message }, error.message.startsWith("Missing") ? 500 : 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return response(null, "text/plain; charset=utf-8", 204);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, module: "unlim-nvidia" });
    }

    if (request.method === "GET" && url.pathname === "/api/models") {
      return json({ default_model: DEFAULT_MODEL, models: getAllowedModels() });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};
