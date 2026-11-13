/**
 * Intel alert sounds (EVE-99), synthesised with Web Audio, so the app ships no sound files. Short and distinct: a
 * notice beep for a report farther out, a sharper alarm for one close by.
 */
import type { IntelSound } from '../../core/settings';

export const INTEL_SOUND_LABEL: Record<IntelSound, string> = {
  beep: 'Beep',
  double: 'Double beep',
  chime: 'Chime',
  alarm: 'Alarm',
};

/** [start s, frequency Hz, length s, wave] per tone. */
const TONES: Record<IntelSound, [number, number, number, OscillatorType][]> = {
  beep: [[0, 880, 0.16, 'sine']],
  double: [
    [0, 988, 0.11, 'sine'],
    [0.16, 988, 0.11, 'sine'],
  ],
  chime: [
    [0, 659, 0.35, 'triangle'],
    [0.12, 988, 0.45, 'triangle'],
  ],
  alarm: [
    [0, 740, 0.12, 'square'],
    [0.15, 988, 0.12, 'square'],
    [0.3, 1318, 0.18, 'square'],
  ],
};

let ctx: AudioContext | null = null;

export function playIntelSound(sound: IntelSound, volume: number): void {
  if (volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    // Square waves sound much louder than sines at the same gain.
    const gainScale = sound === 'alarm' ? 0.12 : 0.35;
    for (const [start, freq, len, type] of TONES[sound]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const t = t0 + start;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume * gainScale, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + len + 0.02);
    }
  } catch {
    // No audio device: the strip still shows the report.
  }
}
