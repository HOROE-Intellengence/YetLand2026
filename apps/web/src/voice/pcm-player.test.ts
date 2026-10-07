import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumePcm, PcmPlayer } from './pcm-player';

describe('playback-driven transcript timing', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup() {
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
    const context = { state: 'running', currentTime: 0, destination: {},
      resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
      createBuffer: (_channels: number, samples: number, rate: number) => ({ duration: samples / rate, getChannelData: () => new Float32Array(samples) }),
      createBufferSource: () => source };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
    return { context, source, frame, frames, player: new PcmPlayer() };
  }
  it('reveals nothing before actual start, follows audio time, pauses with audio and completes on end', async () => {
    const { player, context, source, frame, frames } = setup(), progress = vi.fn();
    await player.unlock();
    expect(player.append(new Uint8Array(48000), progress)).toBe(true); // One second.
    frame(); expect(progress).not.toHaveBeenCalled();
    context.currentTime = 0.58; frame(); expect(progress.mock.lastCall?.[0]).toBeCloseTo(0.5);
    context.state = 'suspended'; frame(); expect(progress).toHaveBeenCalledTimes(1);
    context.state = 'running'; context.currentTime = 0.83; frame(); expect(progress.mock.lastCall?.[0]).toBeCloseTo(0.75);
    source.onended!(); expect(progress).toHaveBeenLastCalledWith(1); expect(frames.size).toBe(0);
  });
  it('does not reveal text for blocked playback or finish the transcript when playback is stopped', async () => {
    const { player, context, frame, frames, source } = setup(), progress = vi.fn();
    expect(player.append(new Uint8Array(48000), progress)).toBe(false);
    await player.unlock(); context.state = 'suspended';
    expect(player.append(new Uint8Array(48000), progress)).toBe(false);
    context.state = 'running'; player.append(new Uint8Array(48000), progress);
    player.stop(); frame(); expect(progress).not.toHaveBeenCalled();
    expect(frames.size).toBe(0); expect(source.onended).toBeNull();
  });
  it('keeps ordinary voice playback free of transcript animation', async () => {
    const { player, frames } = setup(); await player.unlock();
    expect(player.append(new Uint8Array(48000))).toBe(true); expect(frames.size).toBe(0);
    player.dispose();
  });
});

describe('PCM stream cursor', () => {
  it('reassembles samples split by network chunks', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array([1])); c.enqueue(new Uint8Array([2, 3]));
      c.enqueue(new Uint8Array([4, 5, 6])); c.close();
    } });
    const received: number[] = [];
    await consumePcm(body, b => { expect(b.length % 2).toBe(0); received.push(...b); });
    expect(received).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('does not commit an incomplete sample on disconnect, allowing exact resume', async () => {
    let step = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) {
      if (!step++) c.enqueue(new Uint8Array([1, 2, 3])); else c.error(new Error('offline'));
    } });
    let offset = 0;
    await expect(consumePcm(body, b => { offset += b.length; })).rejects.toThrow('offline');
    expect(offset).toBe(2);
  });
});
