import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local experiment only. Read the current Yelan main binding; never copy its key
// into client settings, logs, or another configuration file.
async function mainConfig() {
  const state = JSON.parse(await readFile(resolve(process.cwd(), "../apps/api/.local/state.json"), "utf8"));
  const inventory = state.llmApiInventory;
  const entry = inventory?.entries?.[inventory.mainApiId];
  if (!entry?.enabled || !entry.apiKey || !entry.model || entry.protocol !== "openai-compatible") {
    throw new Error("夜阑主模型配置不可用或不是 OpenAI 兼容接口");
  }
  return entry as { apiKey: string; baseUrl: string; model: string };
}

function allowed(req: NextRequest) {
  if (process.env.YELAN_PHONE_MANAGED === 'true') return false;
  if (process.env.YELAN_PHONE_LOCAL !== "true") return false;
  const host = req.headers.get("host") || "";
  if (!/^(localhost|127\.0\.0\.1):3001$/.test(host)) return false;
  const origin = req.headers.get("origin");
  return (!origin || origin === `http://${host}`) && req.headers.get("sec-fetch-site") !== "cross-site";
}

export async function GET(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "仅限本地调试" }, { status: 403 });
  try {
    const config = await mainConfig();
    if (req.nextUrl.pathname === "/api/yelan/config") {
      return NextResponse.json({
        id: "yelan-shared-local", name: "夜阑共用 · 本地调试", provider: "Custom",
        baseUrl: "/api/yelan/v1", apiKey: "yelan-server-managed",
        defaultModel: config.model, enableNativeTools: true,
        enableImageRecognition: true, enableImageGeneration: false,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (req.nextUrl.pathname === "/api/yelan/v1/models") {
      return NextResponse.json({ object: "list", data: [{ id: config.model, object: "model", owned_by: "yelan" }] });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "无法读取夜阑主模型，请检查本地配置" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "仅限本地调试" }, { status: 403 });
  if (req.nextUrl.pathname !== "/api/yelan/v1/chat/completions") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }
  try {
    const config = await mainConfig();
    const upstream = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ ...body, model: config.model }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(180000)]),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return NextResponse.json({ error: `夜阑共用模型请求失败（${upstream.status}）` }, { status: upstream.status });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return NextResponse.json({ error: "夜阑共用模型暂不可用或请求超时" }, { status: 502 });
  }
}
