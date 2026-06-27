export const STREAM_IDLE_TIMEOUT_MS = 30_000;

export interface StreamGuard {
  signal: AbortSignal;
  keepAlive: () => void;
  dispose: () => void;
}

export function createStreamGuard(
  callerSignal: AbortSignal | undefined,
  idleMs: number = STREAM_IDLE_TIMEOUT_MS,
): StreamGuard {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => ac.abort(new Error(`LLM 上游流空闲超过 ${idleMs}ms 未结束`)),
      idleMs,
    );
    timer.unref?.();
  };

  const onCallerAbort = () => ac.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) ac.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  arm();

  return {
    signal: ac.signal,
    keepAlive: arm,
    dispose: () => {
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}
