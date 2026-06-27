# Chat Latency Diagnosis, 2026-05-21

## Executive Summary

This is not a single sidecar problem.

The current admin selection says main is `horoe-main / gemini-3.1-flash-lite`, and sidecar is `horoe-sidecar / gemini-3.1-flash-lite`.
However, the runtime main router includes every ready provider in the main fallback chain. In this environment that chain is effectively:

1. `horoe-main / gemini-3.1-flash-lite`
2. `env-nvidia / z-ai/glm-5.1`
3. `horoe-sidecar / gemini-3.1-flash-lite`

Server logs confirm `horoe-main` timed out and the main path fell through to `env-nvidia` at least during the test. One request then exhausted all three providers and returned an SSE `error`.

The sidecar architecture also adds visible latency because two sidecar calls are currently on the user-visible critical path:

- `atmosphereJudge` runs before the SSE stream starts.
- `outputStructurer` runs after main text generation but before `done`.

The after-done sidecars, `preferenceRecorder` and `contextCompressor`, are not the primary visible latency source because they are fired after `done`.

## Environment Snapshot

API health:

- API: `http://127.0.0.1:8787`
- deploy mode: `local`
- LLM ready providers: `env-nvidia`, `horoe-sidecar`, `horoe-main`
- sidecar model: `gemini-3.1-flash-lite`

Admin LLM inventory:

| Role | Selected id | Model | Base URL |
| --- | --- | --- | --- |
| main | `horoe-main` | `gemini-3.1-flash-lite` | `https://horoe.cn/v1` |
| sidecar | `horoe-sidecar` | `gemini-3.1-flash-lite` | `https://horoe.cn/v1` |
| ready fallback | `env-nvidia` | `z-ai/glm-5.1` | `https://integrate.api.nvidia.com/v1` |

## Five-Turn Measurement

Session: `diag_latency_1779370535326`

Note: the PowerShell-to-Node inline script rendered the Chinese input literals as question marks in the diagnostic output. That affects semantic content only; the latency profile is still valid because the requests still exercised the same chat pipeline, sidecar calls, main routing, streaming, structuring, and persistence path.

| Turn | Pre-main sidecar to first event | Main delay after first event | Main output span | Structurer delay | Total to done | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 2.84s | 51.16s | 0.21s | 3.38s | 57.59s | ok |
| 2 | 8.90s | 54.76s | 3.19s | 9.91s | 76.75s | ok |
| 3 | 8.08s | 10.84s | 0.08s | 4.67s | 23.66s | ok |
| 4 | 42.87s | 2.56s | 0.25s | 48.31s | 93.98s | ok |
| 5 | 42.97s | 90.06s | n/a | n/a | 133.03s | main error |

Aggregate:

- Average total: about 77.0s.
- Median total: about 76.8s.
- Pre-main sidecar median: about 8.9s, with two spikes around 43s.
- Main path often exceeded the expected 4s. The slow turns align with router fallback behavior.
- Structurer sidecar is usually 3-10s, but had one 48s spike.

## Observed Content Flow

For each user turn, the visible chain is:

1. `resolveTemperature`
   - Input shape: character name, character personality, boundary, stage, round, IF state, recent temperature log, recent persisted conversation, current user input.
   - Output observed through SSE: temperatures `1, 1, 1, 3, 4`.
   - This blocks SSE headers and the first `meta` event.

2. Main LLM
   - Input shape: assembled system prompt plus sidecar block, recent history, current user text.
   - The sidecar block injects current temperature, user profile, and old-summary snippets.
   - Output observed through SSE `chunk` events.
   - Turn outputs were short; chunks ranged from 2 to 4 on successful turns.

3. `outputStructurer`
   - Input shape: full assistant buffer.
   - Output observed through SSE `structured` event.
   - Successful turns produced 1, 2, 3, and 4 structured parts.
   - This blocks `done`.

4. After-done sidecars
   - `preferenceRecorder` and `contextCompressor` run after `done`.
   - They are not the current visible 50s blocker, although they can still consume provider capacity in the background.

## Runtime Evidence

Server stderr during the five-turn run:

```text
[llm-router] horoe-main failed: LLM 上游流空闲超过 30000ms 未结束
[llm-router] horoe-main failed: LLM 上游流空闲超过 30000ms 未结束
[llm-router] horoe-main failed: LLM 上游流空闲超过 30000ms 未结束
[llm-router] env-nvidia failed: LLM 上游流空闲超过 30000ms 未结束
[llm-router] horoe-sidecar failed: LLM 上游流空闲超过 30000ms 未结束
[chat] error: LLM 上游流空闲超过 30000ms 未结束
```

This proves that the active primary main selection is Gemini Flash, but the actual main runtime can still hit GLM 5.1 via fallback.

## Code Findings

Critical path:

- `apps/api/src/routes/chat.ts`
  - line 83: awaits `resolveTemperature` before opening SSE.
  - line 140: streams the main LLM.
  - line 151: awaits `structureOrFallback` before emitting `done`.
  - line 173: after-done sidecars are called after `done`.

Provider mixing:

- `apps/api/src/llm/create-router.ts`
  - line 8: loads all enabled LLM configs.
  - line 21: sets only `mainProviderId`, but the provider list still includes sidecar and env providers.

- `packages/llm/src/router.ts`
  - line 52: `pickChain` orders selected main first, then all other ready providers.
  - line 87: streams through each provider in chain.
  - line 91: logs provider failure and continues.

- `apps/api/src/services/llm-api-inventory.ts`
  - line 245: if selected role config is unavailable, it falls back to the first ready entry.
  - line 251: `getEnabledLlmApiConfigs` returns all ready entries except task-bound entries.
  - line 257: selected sidecar can still be included in the router provider list.

Sidecar timeout gap:

- `apps/api/src/sidecar-ai/client.ts`
  - line 45: sidecar `fetch` has no explicit timeout.
  - lines 58-59: every sidecar call allows up to 1024 tokens and requests JSON mode.

## Root Cause

Root cause A: main routing is not role-isolated.

The system lets non-main providers become main fallbacks. Therefore:

- selected main is Gemini Flash;
- actual main can still become GLM 5.1;
- actual main can even become the sidecar provider;
- SSE and cost accounting do not expose the actual provider used.

Root cause B: sidecars are serial blockers.

The architecture puts `atmosphereJudge` before SSE and `outputStructurer` before `done`. This guarantees extra perceived latency even when all models are fast.

Root cause C: sidecar calls have no strict latency budget.

The pre-main sidecar spiked to about 43s twice. The structurer spiked to about 48s once. With no timeout, a "cheap small model" can still stall the user path.

Root cause D: fallback policy amplifies latency.

On turn 5 the system spent about 90s after the first event trying providers sequentially: primary main, GLM fallback, sidecar fallback. This is exactly the wrong failure mode for chat UX.

## Modification Advice

### P0: Role-Isolate Main Routing

Change main router construction so it only receives main-capable providers.

Minimum viable fix:

- Build `LlmRouter` with only the selected main provider.
- Do not include `sidecarApiId` in the main router.
- Do not include `env-nvidia` unless it is explicitly selected as main or explicitly marked as a main fallback.

Better fix:

- Add `capabilities` or `role` to each LLM inventory entry.
- Add explicit `mainFallbackIds`.
- Default to fail-closed when selected main is unavailable.

Expected impact:

- Removes silent GLM fallback.
- Removes sidecar-as-main fallback.
- Makes the observed model match admin selection.

### P0: Add Actual Provider Tracing

Emit or store per-node trace:

- request id
- node: `atmosphereJudge`, `main`, `outputStructurer`, `preferenceRecorder`, `contextCompressor`
- provider id
- model
- base URL host
- input chars or estimated tokens
- output chars
- duration
- status or error
- fallback reason

At minimum, add `mainProviderId` and `mainModel` to SSE `meta`, and record actual provider in cost rows. Current `recordTurnCost` uses `router.getMainModel()`, which can be false when fallback is used.

### P1: Put Sidecars Under Time Budget

Recommended budgets:

- `atmosphereJudge`: 1200-2000ms, then use current temperature or deterministic fallback.
- `outputStructurer`: 1500-3000ms, then use regex fallback.
- after-done sidecars: 3000-5000ms, but never block visible chat completion.

Use `AbortController` in `sidecarCall`.

### P1: Stop Blocking `done` on Structuring

Current behavior waits for AI structuring before `done`.

Preferred behavior:

- stream main chunks;
- immediately produce regex fallback structure;
- emit `done`;
- optionally send a later `structured:update` if AI structuring returns in budget.

If frontend cannot handle late updates yet, keep the existing event shape but race AI structuring against a short timeout and fallback.

### P1: Move Temperature Judgment Out of the Hard Pre-SSE Path

Recommended behavior:

- emit `meta` immediately;
- use current temperature or a deterministic cheap heuristic for this turn;
- run atmosphere sidecar in parallel and store result for the next turn;
- if it returns within budget, it can still affect this turn before main call starts, but it must not hold the stream hostage.

### P2: Split Sidecar Task Routing

`atmosphereJudge` and `outputStructurer` currently use the general sidecar selection. Add task-specific selectors for them, the same way `preferenceRecorder`, `quotaEnding`, and `contextCompressor` already have task slots.

Expected impact:

- Lets us disable or swap only the slow sidecar task.
- Lets atmosphere use a tiny JSON model with low max tokens.
- Lets output structurer use a different timeout/model policy.

### P2: Change Main Fallback Policy

For interactive chat, sequential 30s provider fallback is worse than a clean failure.

Recommended policy:

- first-token timeout: 8-12s for Flash-class models;
- if primary main misses budget, return explicit retryable error or a short fallback message;
- only fallback to providers explicitly marked main-compatible;
- never fallback from main to sidecar by readiness alone.

## Verdict

The 50s latency is caused by both architecture and routing:

- Architecture adds serial sidecar latency on the visible path.
- Routing allows the actual main model to fall back into `z-ai/glm-5.1` despite admin selecting Gemini Flash.

The first fix should be role isolation plus tracing. Without that, future latency audits will keep guessing which node actually answered.
