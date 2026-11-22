import { beatSec, MOTION_FILM, type MotionSection, type Timeline } from "@ys/core";
import { MUSIC, MUSIC_RATE, speechRegions } from "../music.ts";

/**
 * Hareketli grafik filminin müziği: filmin temposunda ve ritim çizelgesinin bölümlerinde, koddan sentezlenir (API ve dosya
 * yok). Görüntü ile müzik tek ızgarayı paylaşır: kesmeler vuruşta, ölçü başları bölüm sınırında. Bölümün adı ve enerjisi
 * dokuyu belirler (huashu-motion rhythm.md §6: tempo değil doku değişir): kanca ilk vuruştan davul; kurulumda yarım
 * zaman, enerji 6 ve üstünde düz dört; zirvede tam davul, on altılık zil ve sekizlik bas; duruşta sessizlik ve sonraki
 * bölüme ters zil; çözülmede yalnız pad ve tek vuruş. Her bölümün son vuruşunda (sonraki duruş değilse) trampet dolgusu.
 * Anlatım varsa müzik onun altında kısılır (music.ts ile aynı kurallar).
 */
export const SCORE = {
  /** Anlatımsız filmde müziğin RMS düzeyi (~−19 dBFS; render loudnorm ile −14 LUFS'a getirir). */
  rms: 0.11,
  /** Minör akor yürüyüşü (derece) ve majör tonik seçenekleri (MIDI); tonik bölüm kimliğinden. */
  chords: [0, 5, 2, 6],
  keys: [57, 59, 60, 62, 64],
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const degree = (tonic: number, d: number) => tonic + MINOR[d % 7]! + 12 * Math.floor(d / 7);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Tohumlu gürültü (mulberry32). */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Bölümün çalma biçimi (enerjiden): hangi çalgı ne sıklıkta. */
export interface Groove {
  /** Bas davul vuruşları (ölçü içi vuruş). */
  kick: number[];
  snare: number[];
  /** Zil alt bölümü: 0 yok, 2 sekizlik, 4 on altılık. */
  hats: 0 | 2 | 4;
  /** Bas: 0 yok, 1 vuruşta, 2 sekizlik. */
  bass: 0 | 1 | 2;
  pad: boolean;
  /** Bölüm başında zil (crash). */
  crash: boolean;
}

export function grooveOf(s: MotionSection): Groove {
  const e = s.energy;
  switch (s.name) {
    case "stop":
      return { kick: [], snare: [], hats: 0, bass: 0, pad: false, crash: false };
    case "resolve":
      return { kick: e >= 5 ? [0, 2] : [0], snare: [], hats: e >= 5 ? 2 : 0, bass: 1, pad: true, crash: true };
    case "peak":
      return { kick: [0, 1, 2, 3], snare: [1, 3], hats: e >= 8 ? 4 : 2, bass: 2, pad: true, crash: true };
    case "hook":
      return { kick: e >= 6 ? [0, 1, 2, 3] : [0, 2], snare: e >= 6 ? [1, 3] : [], hats: 2, bass: e >= 5 ? 2 : 1, pad: e < 8, crash: false };
    case "build":
      return { kick: e >= 6 ? [0, 1, 2, 3] : [0, 2.5], snare: [2], hats: e >= 4 ? 2 : 0, bass: e >= 5 ? 2 : 1, pad: true, crash: false };
  }
}

/** Davul ve bas sesleri (örnek dizisine eklenir). */
function kick(out: Float32Array, at: number, gain: number) {
  let ph = 0;
  for (let k = 0; k < 0.3 * MUSIC_RATE && at + k < out.length; k++) {
    const t = k / MUSIC_RATE;
    ph += (2 * Math.PI * (45 + 95 * Math.exp(-t * 35))) / MUSIC_RATE;
    out[at + k]! += Math.sin(ph) * Math.exp(-t * 9) * gain;
  }
}
function snare(out: Float32Array, at: number, gain: number, rnd: () => number) {
  let low = 0;
  for (let k = 0; k < 0.2 * MUSIC_RATE && at + k < out.length; k++) {
    const t = k / MUSIC_RATE;
    const x = rnd();
    low += 0.25 * (x - low);
    out[at + k]! += ((x - low) * Math.exp(-t * 22) * 0.8 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.5) * gain;
  }
}
function hat(out: Float32Array, at: number, gain: number, rnd: () => number, open = false) {
  let prev = 0;
  for (let k = 0; k < (open ? 0.5 : 0.05) * MUSIC_RATE && at + k < out.length; k++) {
    const t = k / MUSIC_RATE;
    const x = rnd();
    out[at + k]! += (x - prev) * Math.exp(-t * (open ? 6 : 90)) * gain;
    prev = x;
  }
}
function pluck(out: Float32Array, at: number, len: number, f: number, gain: number) {
  let y = 0;
  let ph = 0;
  for (let k = 0; k < len && at + k < out.length; k++) {
    const t = k / MUSIC_RATE;
    ph = (ph + f / MUSIC_RATE) % 1;
    const saw = 2 * ph - 1;
    // Kısa açılıp kapanan süzgeç: tok bas.
    y += (1 - Math.exp((-2 * Math.PI * (180 + 900 * Math.exp(-t * 18))) / MUSIC_RATE)) * (saw - y);
    out[at + k]! += y * Math.min(1, t / 0.004, (len - k) / (0.01 * MUSIC_RATE)) * gain;
  }
}

/** Ritim çizelgesine göre müzik izi (16 bit mono, MUSIC_RATE); anlatımda kısılır, baş ve son yumuşak. */
export function scoreTrack(timeline: Timeline, seed: string): { samples: Int16Array; sections: string[] } {
  const look = timeline.motion!;
  const n = Math.ceil((timeline.durationInFrames / timeline.fps) * MUSIC_RATE);
  const beat = beatSec(look.bpm) * MUSIC_RATE;
  const bar = beat * MOTION_FILM.beatsPerBar;
  const tonic = SCORE.keys[hash(seed) % SCORE.keys.length]! - 12;
  const rnd = noise(hash(seed));
  const drums = new Float32Array(n);
  const tone = new Float32Array(n);
  const sections = look.sections.length ? look.sections : [{ name: "build" as const, bars: Math.ceil(n / bar), energy: 6 }];
  let barIndex = 0;
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si]!;
    const g = grooveOf(s);
    const next = sections[si + 1];
    const from = Math.round(barIndex * bar);
    if (g.crash && from < n) hat(drums, from, 0.35, rnd, true);
    for (let b = 0; b < s.bars; b++, barIndex++) {
      const at0 = barIndex * bar;
      if (at0 >= n) break;
      const chord = SCORE.chords[barIndex % SCORE.chords.length]!;
      const root = hz(degree(tonic, chord) - 12);
      const lastBar = b === s.bars - 1;
      for (const k of g.kick) kick(drums, Math.round(at0 + k * beat), 0.9);
      for (const k of g.snare) snare(drums, Math.round(at0 + k * beat), 0.45, rnd);
      if (g.hats) for (let h = 0; h < 4 * g.hats; h++) hat(drums, Math.round(at0 + (h * beat) / g.hats), h % g.hats ? 0.12 : 0.2, rnd);
      // Dolgu: bölümün son vuruşunda on altılık trampet (sonraki duruşsa susar).
      if (lastBar && next && next.name !== "stop" && s.name !== "stop") for (let r = 0; r < 4; r++) snare(drums, Math.round(at0 + 3 * beat + (r * beat) / 4), 0.2 + 0.08 * r, rnd);
      if (g.bass) for (let q = 0; q < 4 * g.bass; q++) pluck(tone, Math.round(at0 + (q * beat) / g.bass), Math.round((beat / g.bass) * 0.85), root, q % g.bass ? 0.18 : 0.26);
      if (g.pad) {
        // Pad: akorun üç sesi, yavaş açılan sinüsler (bir ölçü).
        for (const d of [0, 2, 4]) {
          const f = hz(degree(tonic, chord + d) + 12);
          const a = Math.round(at0);
          for (let k = 0; k < bar && a + k < n; k++) {
            const t = k / MUSIC_RATE;
            tone[a + k]! += Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.25, (bar - k) / (0.2 * MUSIC_RATE)) * 0.05;
          }
        }
      }
    }
    // Duruştan sonraki bölüme ters zil: duruşun son vuruşunda kabarır.
    if (s.name === "stop" && next) {
      const end = Math.round(barIndex * bar);
      for (let k = Math.max(0, end - Math.round(beat)); k < Math.min(n, end); k++) drums[k]! += rnd() * ((k - (end - beat)) / beat) ** 2 * 0.25;
    }
  }
  const mix = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    mix[i] = drums[i]! + tone[i]!;
    sum += mix[i]! * mix[i]!;
  }
  const gain = sum ? SCORE.rms / Math.sqrt(sum / n) : 1;
  const regions = speechRegions(timeline);
  const atk = 1 - Math.exp(-1 / (MUSIC.attackSec * MUSIC_RATE));
  const rel = 1 - Math.exp(-1 / (MUSIC.releaseSec * MUSIC_RATE));
  const fadeOut = MUSIC.fadeOutSec * MUSIC_RATE;
  const samples = new Int16Array(n);
  let g = 1;
  let r = 0;
  for (let i = 0; i < n; i++) {
    while (r < regions.length && regions[r]![1] <= i) r++;
    const target = r < regions.length && regions[r]![0] <= i ? MUSIC.duck : 1;
    g += (target - g) * (target < g ? atk : rel);
    // Kanca ilk vuruştan çalar (giriş kararması yok); son uzun söner.
    const edge = Math.min(1, (n - i) / fadeOut);
    samples[i] = Math.round(Math.tanh(mix[i]! * gain * g * edge * 1.1) * 32767);
  }
  return { samples, sections: sections.map((s) => s.name) };
}
