// lib/llm-http.ts
// LLM 请求的统一 fetch 出口。所有走 buildProviderRequest 的调用点统一经它发请求：
//  - 普通 provider：浏览器直连（现状不变）；
//  - serverProxy 标记（OpenCode 网关）：改发本站 /api/llm-proxy，由服务端转发，
//    绕过 opencode.ai 未开放浏览器 CORS 的问题。

import type { LlmRequestPayload } from "./llm-provider-adapter";
import { isYelanManaged } from './yelan-managed-client';
import { phoneServiceError, recordPhoneDiagnostic } from './phone-diagnostics';

export type FetchLlmPayloadOptions = {
    signal?: AbortSignal;
};

export async function fetchLlmPayload(
    payload: LlmRequestPayload,
    options: FetchLlmPayloadOptions = {},
): Promise<Response> {
    const bodyText = JSON.stringify(payload.body);
    if (payload.serverProxy) {
        return fetch("/api/llm-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                headers: payload.headers,
                body: bodyText,
            }),
            signal: options.signal,
        });
    }
    const response = await fetch(payload.url, {
        method: "POST",
        headers: payload.headers,
        body: bodyText,
        signal: options.signal,
    });
    if (isYelanManaged && !response.ok) {
        recordPhoneDiagnostic('模型调用失败', { status: response.status, response: await response.text() });
        throw new Error('这次回复未完成，请稍后重试。');
    }
    if (isYelanManaged && !payload.body.stream && response.ok) {
        const data = await response.json();
        if (data?.__yelan_error) throw new Error(phoneServiceError(data.error?.message || '回复未完整收到，请稍后重试。'));
        return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
    }
    return response;
}
