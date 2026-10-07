// PCM16 little-endian, mono 24 kHz. One AudioContext per mounted voice screen.
export class PcmPlayer {
  private context?: AudioContext;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private progressFrames = new Map<AudioBufferSourceNode, number>();

  async unlock(): Promise<void> {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }
  append(bytes: Uint8Array, onProgress?: (fraction: number) => void): boolean {
    const context = this.context;
    if (!context || context.state !== 'running' || !bytes.length) return false;
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
    source.onended = () => { clearProgress(); this.sources.delete(source); source.disconnect(); onProgress?.(1); };
    const start = Math.max(this.nextTime, context.currentTime + 0.08);
    source.start(start);
    this.nextTime = start + buffer.duration;
    if (onProgress) {
      const tick = () => {
        // Follow the audio clock, including its scheduled start and suspension.
        // Downloading or merely scheduling audio must not reveal the transcript.
        if (context.state === 'running' && context.currentTime >= start) {
          onProgress(Math.min(1, (context.currentTime - start) / buffer.duration));
        }
        this.progressFrames.set(source, requestAnimationFrame(tick));
      };
      this.progressFrames.set(source, requestAnimationFrame(tick));
    }
    return true;
  }
  async drain(signal: AbortSignal): Promise<void> {
    while (this.sources.size && !signal.aborted && this.context?.state === 'running') {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
  stop(): void {
    for (const frame of this.progressFrames.values()) cancelAnimationFrame(frame);
    this.progressFrames.clear();
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); }
    this.sources.clear(); this.nextTime = 0;
  }
  dispose(): void { this.stop(); void this.context?.close(); this.context = undefined; }
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
