import type { MusicTrack } from './music-storage';

export function createStarterMusicTrack(): MusicTrack {
  return { id: 'starter-window-chimes', title: '窗边 · 初始环境音', artist: '夜阑', album: '日常片刻', duration: 12, liked: false, addedAt: new Date().toISOString(), lyrics: '内置初始环境音。你也可以上传自己喜欢的音乐。' };
}

// A short, original chime synthesized locally; no network or model request.
export function createStarterMusicAudio(): Blob {
  const rate = 22050, seconds = 12, count = rate * seconds;
  const data = new ArrayBuffer(44 + count * 2);
  const view = new DataView(data);
  const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, count * 2, true);
  const notes = [261.63, 329.63, 392, 523.25, 392, 329.63];
  for (let i = 0; i < count; i++) {
    const time = i / rate, noteTime = time % 2, frequency = notes[Math.floor(time / 2)];
    const fade = Math.min(1, noteTime / .04) * Math.exp(-noteTime * 2.2) * Math.min(1, (seconds - time) / .5);
    const sample = (Math.sin(2 * Math.PI * frequency * time) + .25 * Math.sin(4 * Math.PI * frequency * time)) * fade * .16;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return new Blob([data], { type: 'audio/wav' });
}
