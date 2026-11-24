import * as THREE from "three/webgpu";
import { Fn, abs, atan, cameraPosition, cos, exp, float, length, max, mix, mx_noise_float, normalize, pow, sin, smoothstep, uniform, uniformArray, vec2, vec3 } from "three/tsl";
import type { Look } from "./versions";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// The sea everything shares: the light coming down through the surface, the colour and clarity of the water, and the
// way the water moves. Set from the version and eased, so changing sea glides rather than rebuilds.

// The height of the surface; the floor lies about y = 0.
export const SURFACE = 8.5;

export const sea = {
  shallow: uniform(new THREE.Color()),
  deep: uniform(new THREE.Color()),
  sun: uniform(new THREE.Color()),
  power: uniform(1),
  // Toward the sun as it is seen under water, bent down toward straight up by the surface, and as it is above it.
  toSun: uniform(new THREE.Vector3(0, 1, 0)),
  toSunAir: uniform(new THREE.Vector3(0, 1, 0)),
  murk: uniform(0.05),
  absorb: uniform(new THREE.Vector3(2, 1, 1)),
  caustics: uniform(1),
  cell: uniform(1.6),
  flicker: uniform(1),
  shafts: uniform(1),
  glow: uniform(0),
  clock: uniform(0),
  // The swell for things swaying on the floor: its height, and its phase over the floor's middle.
  swell: uniform(0.5),
  surge: uniform(0),
  waveK: uniform(0.7),
  // The steady current, metres a second along x and z, and how far it has carried the water since the page opened.
  drift: uniform(new THREE.Vector2()),
  carried: uniform(new THREE.Vector2()),
  // The last few places the water was stirred, for plankton to light up: xyz, and how fresh it is.
  stirs: uniformArray(
    Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 0)),
    "vec4"
  )
};

// The parts of a look the water's motion reads on the processor, eased like the rest.
// strength is the visitor's Current setting. It sets how fast the steady current runs, always the same way, so a strong
// one bends everything over to one side; the swell only fades in from still water as it rises, and never grows wilder.
export const motion = { swell: 0.5, period: 9, currentX: 0, currentZ: 0, phase: 0, strength: 1, flowX: 0, flowZ: 0, calm: 1 };

// The swell is drawn out to a short wavelength, a few metres, so it is seen to travel through the forest.
const SHORTER = 18;

// Moves the swell on, keeping its phase whole while its period eases.
export function advance(delta: number) {
  const w = (Math.PI * 2) / motion.period;
  motion.phase += w * delta;
  sea.surge.value = motion.phase;
  sea.waveK.value = ((w * w) / 9.81) * SHORTER;
  // The current's speed for a setting: a drift at none, about 0.2 m/s at one, near half a metre a second at the top.
  const speed = Math.hypot(motion.currentX, motion.currentZ) || 1;
  const run = 0.03 + 0.17 * motion.strength;
  motion.flowX = (motion.currentX / speed) * run;
  motion.flowZ = (motion.currentZ / speed) * run;
  motion.calm = Math.min(1, 0.3 + 0.7 * motion.strength);
  sea.swell.value = motion.swell * motion.calm;
  sea.drift.value.set(motion.flowX, motion.flowZ);
  sea.carried.value.x += motion.flowX * delta;
  sea.carried.value.y += motion.flowZ * delta;
}

// Toward the sun under water and above it, from its bearing and how high it is drawn under water, in degrees. Under
// water the sun is drawn lower than the surface would let it be, nearer the eye's line, so it shows shining through
// from the start view without having to look straight up; the sun in the air stands lower still, as the surface bends.
export function sunWays(bearing: number, seenDegrees: number) {
  const e = THREE.MathUtils.degToRad(Math.max(4, 90 - (90 - seenDegrees) * 1.36));
  const b = THREE.MathUtils.degToRad(bearing);
  const seen = THREE.MathUtils.degToRad(seenDegrees);
  const under = new THREE.Vector3(Math.cos(seen) * Math.cos(b), Math.sin(seen), Math.cos(seen) * Math.sin(b)).normalize();
  const air = new THREE.Vector3(Math.cos(e) * Math.cos(b), Math.sin(e), Math.cos(e) * Math.sin(b)).normalize();
  return { under, air };
}

const wanted = {
  shallow: new THREE.Color(),
  deep: new THREE.Color(),
  sun: new THREE.Color(),
  power: 1,
  toSun: new THREE.Vector3(),
  toSunAir: new THREE.Vector3(),
  murk: 0.05,
  absorb: new THREE.Vector3(),
  caustics: 1,
  cell: 1.6,
  flicker: 1,
  shafts: 1,
  glow: 0,
  swell: 0.5,
  period: 9,
  currentX: 0,
  currentZ: 0
};

export function aim(look: Look, now: boolean) {
  wanted.shallow.set(look.shallow);
  wanted.deep.set(look.deep);
  wanted.sun.set(look.sun);
  wanted.power = look.power;
  aimSun(look.bearing, look.seen ?? 34);
  wanted.murk = look.murk;
  wanted.absorb.set(...look.absorb);
  wanted.caustics = look.caustics;
  wanted.cell = look.cell;
  wanted.flicker = look.flicker;
  wanted.shafts = look.shafts;
  wanted.glow = look.glow;
  wanted.swell = look.swell;
  wanted.period = look.period;
  wanted.currentX = look.current[0];
  wanted.currentZ = look.current[1];
  if (now) ease(1);
}

// The sun moved by the dial: eased round to its new place like the rest of the sea.
export function aimSun(bearing: number, seen: number) {
  const ways = sunWays(bearing, seen);
  wanted.toSun.copy(ways.under);
  wanted.toSunAir.copy(ways.air);
}

export function ease(k: number) {
  sea.shallow.value.lerp(wanted.shallow, k);
  sea.deep.value.lerp(wanted.deep, k);
  sea.sun.value.lerp(wanted.sun, k);
  sea.power.value += (wanted.power - sea.power.value) * k;
  sea.toSun.value.lerp(wanted.toSun, k).normalize();
  sea.toSunAir.value.lerp(wanted.toSunAir, k).normalize();
  sea.murk.value += (wanted.murk - sea.murk.value) * k;
  sea.absorb.value.lerp(wanted.absorb, k);
  sea.caustics.value += (wanted.caustics - sea.caustics.value) * k;
  sea.cell.value += (wanted.cell - sea.cell.value) * k;
  sea.flicker.value += (wanted.flicker - sea.flicker.value) * k;
  sea.shafts.value += (wanted.shafts - sea.shafts.value) * k;
  sea.glow.value += (wanted.glow - sea.glow.value) * k;
  motion.swell += (wanted.swell - motion.swell) * k;
  motion.period += (wanted.period - motion.period) * k;
  motion.currentX += (wanted.currentX - motion.currentX) * k;
  motion.currentZ += (wanted.currentZ - motion.currentZ) * k;
}

// The way the swell travels across the floor.
export const SWELL = new THREE.Vector2(1, 0.35).normalize();

// How the water moves at a point: the steady current, the to and fro of the swell passing overhead (each bit of water
// swings round an ellipse that shrinks with depth), and small eddies. lag and pace: for one plant, how far behind the
// swell it rides and how much faster or slower it swings, so plants a few metres apart never sway in step.
export function flow(x: number, y: number, z: number, t: number, out: Float32Array | number[], at = 0, lag = 0, pace = 1) {
  const w = (Math.PI * 2) / motion.period;
  const k = (w * w) / 9.81;
  const phase = k * (SWELL.x * x + SWELL.y * z) * SHORTER - motion.phase * pace + lag;
  t = t * pace + lag * 3;
  const decay = Math.exp(-k * Math.max(0, SURFACE - y));
  const swell = motion.swell * motion.calm * w * decay;
  const along = swell * Math.cos(phase);
  const lift = swell * Math.sin(phase) * 0.5;
  const eddy = (0.035 + motion.swell * 0.02) * motion.calm;
  out[at] = motion.flowX + SWELL.x * along + eddy * Math.sin(0.61 * z + 0.9 * y + t * 0.73) * Math.cos(0.37 * x - t * 0.41);
  out[at + 1] = lift + eddy * 0.5 * Math.sin(0.5 * x + 0.43 * z + t * 0.57);
  out[at + 2] = motion.flowZ + SWELL.y * along + eddy * Math.cos(0.53 * x + 0.7 * y - t * 0.66) * Math.sin(0.41 * z + t * 0.38);
}

// Dave Hoskins' tileable water caustic (MIT, from Shadertoy MdlXz8), unrolled: bright threads where the light gathers.
export function threads(uv: any, t: any): any {
  const TAU = 6.28318530718;
  const p = uv.mul(TAU).mod(TAU).sub(250) as any;
  let i: any = p;
  let c: any = float(1);
  const inten = 0.005;
  for (let n = 0; n < 3; n++) {
    const tt = t.mul(1 - 3.5 / (n + 1)) as any;
    i = p.add(vec2(cos(tt.sub(i.x)).add(sin(tt.add(i.y))), sin(tt.sub(i.y)).add(cos(tt.add(i.x)))));
    c = c.add(float(1).div(length(vec2(p.x.div(sin(i.x.add(tt)).div(inten)), p.y.div(cos(i.y.add(tt)).div(inten))))));
  }
  c = float(1.15).sub(pow(c.div(3), 1.35));
  return pow(abs(c), 7);
}

// Light wavering over a surface at P facing N, as it comes down through the moving surface: traced up toward the sun
// to the surface, split slightly into colours the deeper it has come, softer near the surface where it has not yet
// gathered, and strongest on whatever faces the sun.
export const caustics = Fn(([P, N]: [any, any]) => {
  const below = max(float(SURFACE).sub(P.y), 0) as any;
  const s = sea.toSun as any;
  const q = P.xz.add(s.xz.div(s.y).mul(below)) as any;
  const uv = q.div(sea.cell.mul(4)) as any;
  const t = sea.clock.mul(0.42).mul(sea.flicker).add(23) as any;
  const split = below.mul(0.0025) as any;
  // One trace; the colour split is the same threads seen a little to one side, which is close enough at these widths.
  const c = threads(uv, t) as any;
  const r = c.mul(float(1).add(split.mul(60).min(0.35))) as any;
  const b = c.mul(float(1).sub(split.mul(60).min(0.35))) as any;
  // Patches brighter and darker, as swells focus the light and spread it.
  const patch = mx_noise_float(vec3(q.x.mul(0.07), sea.clock.mul(0.05), q.y.mul(0.07))).mul(0.45).add(0.75) as any;
  const formed = smoothstep(0.2, 2.5, below).mul(1.8) as any;
  const facing = smoothstep(-0.1, 0.6, (N as any).dot(s)) as any;
  return vec3(r, r.add(b).mul(0.5), b).mul(formed.mul(facing).mul(patch).mul(sea.caustics).mul(sea.power)).mul(sea.sun);
});

// The water itself in a direction: bright toward the surface, deep below, and the glow of the sun.
// The water is lit from the sun's side: looking away from it, it falls off into a deep, dark blue, so the light reads as
// pouring in from one side and the far water gives everything depth.
const sunward = (d: any) => mix(float(0.42), float(1), smoothstep(-0.35, 0.85, d.dot(sea.toSun))) as any;

export const environment = Fn(([direction]: [any]) => {
  const d = normalize(direction) as any;
  const up = d.y as any;
  let rgb: any = mix(sea.deep, sea.shallow, smoothstep(-0.55, 0.9, up));
  // The bright disc of sky overhead (Snell's window), soft-edged by the waves.
  rgb = rgb.add(sea.shallow.mul(smoothstep(0.6, 0.8, up).mul(0.9)));
  rgb = rgb.mul(sunward(d));
  const toward = max(d.dot(sea.toSun), 0) as any;
  rgb = rgb.add(sea.sun.mul(pow(toward, 5).mul(0.22).add(pow(toward, 48).mul(0.7)).mul(sea.power).mul(0.35)));
  return rgb;
});

// The water in a direction without the far stalks, for the haze over near things, where they would never show.
export const haze = Fn(([direction]: [any]) => {
  const d = normalize(direction) as any;
  const up = d.y as any;
  let rgb: any = mix(sea.deep, sea.shallow, smoothstep(-0.55, 0.9, up));
  rgb = rgb.add(sea.shallow.mul(smoothstep(0.6, 0.8, up).mul(0.9))).mul(sunward(d));
  const toward = max(d.dot(sea.toSun), 0) as any;
  return rgb.add(sea.sun.mul(pow(toward, 5).mul(0.22).add(pow(toward, 48).mul(0.7)).mul(sea.power).mul(0.35)));
});

// How much light is left after a path through the water, colour by colour.
export const through = (distance: any): any => exp(sea.absorb.mul(sea.murk).mul(distance).negate());

// What anything under water looks like from the eye: its own colour dimmed by the water the light came down through,
// then by the water between it and the eye, giving way to the colour of the water behind it.
export const underwater = Fn(([rgb, P]: [any, any]) => {
  const toP = (P as any).sub(cameraPosition) as any;
  const d = length(toP) as any;
  const down = through(max(float(SURFACE).sub(P.y), 0).mul(0.55)) as any;
  // Thicker along the eye's line than the light's way down, so what stands a little off sinks into the water.
  const kept = through(d.mul(1.6)) as any;
  return (rgb as any).mul(down).mul(kept).add(haze(toP).mul(vec3(1, 1, 1).sub(kept)));
});

// A glow where the water was recently stirred, for plankton.
export const stirred = Fn(([P]: [any]) => {
  let g: any = float(0);
  for (let k = 0; k < 8; k++) {
    const s = sea.stirs.element(k) as any;
    const d = length((P as any).sub(s.xyz)) as any;
    g = g.add(exp(d.mul(d).mul(-2.2)).mul(s.w));
  }
  return g.mul(sea.glow);
});

// How far the water has carried a point at P, for things rooted on the floor to bend with: each bit of water swings to
// and fro with the swell, less the deeper it is, and the steady current leans everything over the same way.
export const swayAt = Fn(([P]: [any]) => {
  const p = P as any;
  const phase = p.x.mul(SWELL.x).add(p.z.mul(SWELL.y)).mul(sea.waveK).sub(sea.surge) as any;
  const decay = exp(sea.waveK.div(SHORTER).mul(max(float(SURFACE).sub(p.y), 0)).negate()) as any;
  const along = sin(phase).mul(sea.swell).mul(decay).negate() as any;
  const eddy = sin(sea.clock.mul(0.9).add(p.x.mul(1.3)).add(p.z.mul(0.7))).mul(0.04) as any;
  const lean = (sea.drift as any).mul(2.2) as any;
  return vec3(along.mul(SWELL.x).add(eddy).add(lean.x), 0, along.mul(SWELL.y).sub(eddy.mul(0.6)).add(lean.y));
});
