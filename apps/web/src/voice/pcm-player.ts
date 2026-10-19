// PCM16 little-endian, mono 24 kHz. One AudioContext per mounted voice screen.
export class PcmPlayer {
  private context?: AudioContext;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private progressFrames = new Map<AudioBufferSourceNode, number>();
  private pending: Array<{ bytes: Uint8Array; progress?: (fraction: number) => void }> = [];
  acceptedBytes = 0;
  playedBytes = 0;
  started = false;
  onStart?: () => void;
  onStateChange?: () => void;
  get needsPlay(): boolean { return !this.finished && this.context?.state !== 'running'; }
  get finished(): boolean { return !this.pending.length && !this.sources.size && this.acceptedBytes === this.playedBytes; }

  async unlock(): Promise<void> {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    this.context.onstatechange = () => { this.flush(); this.onStateChange?.(); };
    if (this.context.state !== 'running') await this.context.resume();
    this.flush(); this.onStateChange?.();
  }
  append(bytes: Uint8Array, onProgress?: (fraction: number) => void): boolean {
    if (!bytes.length) return false;
    if (bytes.length % 2) throw Object.assign(new Error('INVALID_PCM'), { code: 'INVALID_PCM' });
    if (this.acceptedBytes - this.playedBytes + bytes.length > 180 * 48000)
      throw Object.assign(new Error('PLAYBACK_BUFFER_LIMIT'), { code: 'PLAYBACK_BUFFER_LIMIT' });
    this.pending.push({ bytes: bytes.slice(), progress: onProgress });
    this.acceptedBytes += bytes.length;
    this.flush(); this.onStateChange?.();
    return true; // Accepted into owned memory, even while playback is blocked.
  }
  private flush(): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    while (this.pending.length) {
    const { bytes, progress: onProgress } = this.pending[0]!;
    const samples = bytes.length / 2;
    const buffer = context.createBuffer(1, samples, 24000);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.sources.add(source);
    const clearProgress = () => {
      const frame = this.progressFrames.get(source);
      if (frame !== undefined) cancelAnimationFrame(frame);
      this.progressFrames.delete(source);
    };
    source.onended = () => { clearProgress(); this.sources.delete(source); source.disconnect(); this.playedBytes += bytes.length; onProgress?.(1); this.onStateChange?.(); };
    const start = Math.max(this.nextTime, context.currentTime + 0.08);
    source.start(start);
    this.pending.shift();
    this.nextTime = start + buffer.duration;
    if (onProgress || this.onStart) {
      const tick = () => {
        // Follow the audio clock, including its scheduled start and suspension.
        // Downloading or merely scheduling audio must not reveal the transcript.
        if (context.state === 'running' && context.currentTime >= start) {
          if (!this.started) { this.started = true; this.onStart?.(); }
          onProgress?.(Math.min(1, (context.currentTime - start) / buffer.duration));
        }
        this.progressFrames.set(source, requestAnimationFrame(tick));
      };
      this.progressFrames.set(source, requestAnimationFrame(tick));
    }
    }
  }
  async drain(signal: AbortSignal): Promise<void> {
    while (!this.finished && !signal.aborted && this.context?.state === 'running') {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
  stop(): void {
    for (const frame of this.progressFrames.values()) cancelAnimationFrame(frame);
    this.progressFrames.clear();
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); }
    this.sources.clear(); this.pending = []; this.nextTime = 0;
    this.acceptedBytes = 0; this.playedBytes = 0; this.started = false; this.onStateChange?.();
  }
  dispose(): void { this.onStart = undefined; this.onStateChange = undefined; this.stop(); if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}); } this.context = undefined; }
}

// Fetch chunks may split a 16-bit sample. Commit only complete samples so an
// interrupted connection can resume at the exact even byte cursor.
export async function consumePcm(
  body: ReadableStream<Uint8Array>, onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  const reader = body.getReader();
  let tail: number | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      let bytes = value;
      if (tail !== undefined) {
        bytes = new Uint8Array(value.length + 1);
        bytes[0] = tail; bytes.set(value, 1); tail = undefined;
      }
      const end = bytes.length - bytes.length % 2;
      if (end < bytes.length) tail = bytes[end];
      if (end) onChunk(bytes.subarray(0, end));
    }
  } finally { reader.releaseLock(); }
}
