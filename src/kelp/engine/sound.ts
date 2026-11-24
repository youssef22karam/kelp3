import { useEffect } from "react";

// Every sound here is synthesised in WebAudio: no samples and no music files. Bubbles are sine chirps that rise in pitch
// as a real bubble's resonance does when it pinches off; the dial's click is a short burst of filtered noise; and the
// ambience is a slow bed of brown noise through a moving low-pass, with soft detuned drones and the odd distant bubble.

type Name = "plop" | "drip" | "click";
type Options = { gain?: number; pitch?: number; pan?: number; gap?: number };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const lastPlayed: Record<string, number> = {};
const unlockListeners = new Set<() => void>();

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  // A gentle limiter so piles of bubbles never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.ratio.value = 8;
  master.connect(limiter).connect(ctx.destination);
  return ctx;
}

// Browsers only allow sound after a gesture.
if (typeof window !== "undefined") {
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") c.resume();
    unlockListeners.forEach((l) => l());
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(c: AudioContext) {
  if (noiseBuffer) return noiseBuffer;
  const length = c.sampleRate * 2;
  noiseBuffer = c.createBuffer(1, length, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function output(c: AudioContext, pan: number) {
  if (c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(master!);
    return p;
  }
  return master!;
}

function plop(c: AudioContext, gain: number, pitch: number, pan: number, rise: number, length: number) {
  const t = c.currentTime + 0.005;
  const osc = c.createOscillator();
  const env = c.createGain();
  const f0 = 260 * pitch;
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * rise, t + length * 0.8);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(env).connect(output(c, pan));
  osc.start(t);
  osc.stop(t + length + 0.02);
}

function click(c: AudioContext, gain: number, pitch: number, pan: number) {
  const t = c.currentTime + 0.002;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3200 * pitch;
  band.Q.value = 6;
  const env = c.createGain();
  env.gain.setValueAtTime(gain * 1.4, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  src.connect(band).connect(env).connect(output(c, pan));
  src.start(t, Math.random());
  src.stop(t + 0.04);
}

export const sound = {
  play(name: Name, { gain = 0.2, pitch = 1, pan = 0, gap = 0 }: Options = {}) {
    const c = ctx;
    if (!c || c.state !== "running" || muted) return;
    const now = performance.now() / 1000;
    if (gap && now - (lastPlayed[name] ?? 0) < gap) return;
    lastPlayed[name] = now;
    if (name === "plop") plop(c, gain * 0.5, pitch, pan, 2.4, 0.12 + 0.06 / pitch);
    else if (name === "drip") plop(c, gain * 0.45, pitch * 2.2, pan, 1.6, 0.07);
    else click(c, gain * 0.3, pitch, pan);
  },
  get muted() {
    return muted;
  },
  setMuted(next: boolean) {
    muted = next;
    if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.8, ctx.currentTime, 0.1);
  }
};

// The underwater ambience, synthesised: a deep wash of brown noise breathing through a slowly swept low-pass, two soft
// detuned drones a fifth apart, and every so often a far-off string of bubbles.
function startAmbience(c: AudioContext, volume: number) {
  const bus = c.createGain();
  bus.gain.setValueAtTime(0, c.currentTime);
  bus.gain.linearRampToValueAtTime(volume, c.currentTime + 4);
  bus.connect(master!);

  // Brown noise: integrated white noise.
  const length = c.sampleRate * 4;
  const buffer = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  }
  const wash = c.createBufferSource();
  wash.buffer = buffer;
  wash.loop = true;
  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 380;
  low.Q.value = 0.7;
  const sweep = c.createOscillator();
  sweep.frequency.value = 0.07;
  const sweepDepth = c.createGain();
  sweepDepth.gain.value = 180;
  sweep.connect(sweepDepth).connect(low.frequency);
  const washGain = c.createGain();
  washGain.gain.value = 0.55;
  const breathe = c.createOscillator();
  breathe.frequency.value = 0.11;
  const breatheDepth = c.createGain();
  breatheDepth.gain.value = 0.18;
  breathe.connect(breatheDepth).connect(washGain.gain);
  wash.connect(low).connect(washGain).connect(bus);

  // Drones.
  const drones: OscillatorNode[] = [];
  const droneFilter = c.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 420;
  const droneGain = c.createGain();
  droneGain.gain.value = 0.05;
  droneFilter.connect(droneGain).connect(bus);
  for (const [f, detune] of [
    [55, -6],
    [55, 7],
    [82.4, -4],
    [82.4, 5],
    [110, 0]
  ]) {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(droneFilter);
    drones.push(o);
  }
  const shimmer = c.createOscillator();
  shimmer.frequency.value = 0.05;
  const shimmerDepth = c.createGain();
  shimmerDepth.gain.value = 0.025;
  shimmer.connect(shimmerDepth).connect(droneGain.gain);

  const all = [wash, sweep, breathe, shimmer, ...drones];
  all.forEach((n) => n.start());

  // Distant bubbles now and then.
  let timer = 0;
  const bubbles = () => {
    timer = window.setTimeout(bubbles, 2500 + Math.random() * 6000);
    if (c.state !== "running" || muted) return;
    const n = 3 + Math.floor(Math.random() * 7);
    const pan = (Math.random() - 0.5) * 1.4;
    for (let i = 0; i < n; i++)
      window.setTimeout(() => plop(c, 0.012 + Math.random() * 0.02, 0.8 + Math.random() * 1.4, pan + (Math.random() - 0.5) * 0.3, 2.2, 0.14), i * (60 + Math.random() * 90));
  };
  timer = window.setTimeout(bubbles, 2000);

  return () => {
    window.clearTimeout(timer);
    bus.gain.setTargetAtTime(0, c.currentTime, 0.4);
    window.setTimeout(() => {
      all.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      });
      bus.disconnect();
    }, 2000);
  };
}

// The original played an mp3 here; this ignores the url and synthesises its own ambience instead.
export function useMusic(_url: string, volume = 0.4) {
  useEffect(() => {
    let stop: (() => void) | null = null;
    const begin = () => {
      if (stop) return;
      const c = audio();
      if (!c || !master) return;
      if (c.state === "suspended") c.resume();
      stop = startAmbience(c, volume);
    };
    if (ctx && ctx.state === "running") begin();
    else unlockListeners.add(begin);
    return () => {
      unlockListeners.delete(begin);
      stop?.();
    };
  }, [volume]);
}
