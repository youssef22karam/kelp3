import * as THREE from "three/webgpu";
import { waterAt } from "./stir";
import { SURFACE } from "./water";

// Chains of points rooted at one end and moved by the water: kelp stipes, blades of sugar kelp, anything long and
// flexible. Carried by the water round each point (dragged toward its speed), lifted by floats, and held to length by
// following the chain out from the root, which keeps it from ever stretching.
//
// Stepped at a fixed rate whatever the frame rate, and drawn between the last two steps, so motion stays smooth when
// frames come unevenly. How the water streams past each point is smoothed too, for blades to follow without fidgeting.

export const STEP = 1 / 90;

// A chain can grow from a point of another, earlier in the list, instead of from the floor: parent is that point's
// index (chain * nodes + node). It goes where that point goes and does not pull back on it.
export type ChainSpec = { root: THREE.Vector3; length: number; lift: number; lean?: THREE.Vector3; parent?: number };

// A point held by the pointer: which chain and node, and where it is being pulled to.
export type Hold = { chain: number; node: number; target: THREE.Vector3 };

// How fast any point of a plant may move through the water, m/s: a little over the swell's own top speed.
const MOST_SPEED = 0.55;

export class Chains {
  specs: ChainSpec[];
  nodes: number;
  segment: Float32Array;
  position: Float32Array;
  previous: Float32Array;
  // The state one step back, and the one drawn: between that and the latest.
  last: Float32Array;
  shown: Float32Array;
  // The water's speed past each point, smoothed.
  stream: Float32Array;
  time = 0;
  ceiling: number;
  ground: (x: number, z: number) => number;
  // How firmly the water drags the chain along, at the root and at the tip.
  drag: [number, number];
  // Seconds per step: the giants at 90 a second; small plants, whose motion is slight, can take fewer.
  rate: number;
  hold: Hold | null = null;
  private carry = 0;
  private water = new Float32Array(3);
  // The water round each point, sampled every other step: it changes over seconds, so half as often never shows.
  private sampled: Float32Array;
  private ticks = 0;
  private lag: Float32Array;
  private pace: Float32Array;

  constructor(specs: ChainSpec[], nodes: number, options: { ceiling?: number; ground: (x: number, z: number) => number; drag?: [number, number]; settle?: number; rate?: number }) {
    this.specs = specs;
    this.nodes = nodes;
    // Each plant its own lag behind the swell and pace through it; a branch rides with the plant it grows from.
    this.lag = new Float32Array(specs.length);
    this.pace = new Float32Array(specs.length);
    specs.forEach((spec, i) => {
      if (spec.parent !== undefined) {
        const from = Math.floor(spec.parent / nodes);
        this.lag[i] = this.lag[from];
        this.pace[i] = this.pace[from];
        return;
      }
      const h = Math.sin(spec.root.x * 12.9898 + spec.root.z * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      this.lag[i] = r * Math.PI * 2;
      this.pace[i] = 0.85 + ((r * 7.31) % 1) * 0.3;
    });
    this.ceiling = options.ceiling ?? SURFACE - 0.04;
    this.ground = options.ground;
    this.drag = options.drag ?? [1.6, 3];
    this.rate = options.rate ?? STEP;
    const n = specs.length * nodes;
    this.segment = new Float32Array(specs.map((s) => s.length / (nodes - 1)));
    this.position = new Float32Array(n * 3);
    this.previous = new Float32Array(n * 3);
    this.last = new Float32Array(n * 3);
    this.shown = new Float32Array(n * 3);
    this.stream = new Float32Array(n * 3);
    this.sampled = new Float32Array(n * 3);
    specs.forEach((s, i) => {
      const lean = (s.lean ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
      for (let k = 0; k < nodes; k++) {
        const o = (i * nodes + k) * 3;
        this.position[o] = s.root.x + lean.x * this.segment[i] * k;
        this.position[o + 1] = Math.min(this.ceiling, s.root.y + lean.y * this.segment[i] * k);
        this.position[o + 2] = s.root.z + lean.z * this.segment[i] * k;
      }
    });
    this.previous.set(this.position);
    // Left to settle under its real load before it is shown.
    for (let k = 0; k < (options.settle ?? 120) * (STEP / this.rate); k++) this.step(this.rate);
    this.last.set(this.position);
    this.shown.set(this.position);
  }

  // Moves on by a frame's time, in whole fixed steps, and works out what to draw.
  update(delta: number) {
    const rate = this.rate;
    this.carry = Math.min(this.carry + Math.max(0, delta), rate * 8);
    while (this.carry >= rate) {
      this.last.set(this.position);
      this.step(rate);
      this.carry -= rate;
    }
    const a = this.carry / rate;
    const p = this.position;
    const l = this.last;
    const s = this.shown;
    for (let i = 0; i < s.length; i++) s[i] = l[i] + (p[i] - l[i]) * a;
  }

  private step(dt: number) {
    this.time += dt;
    const t = this.time;
    const p = this.position;
    const q = this.previous;
    const water = this.water;
    const fresh = this.ticks++ % 2 === 0;
    const sampled = this.sampled;
    const smooth = 1 - Math.exp(-dt * 1.4);
    const N = this.nodes;
    const [dragRoot, dragTip] = this.drag;
    for (let i = 0; i < this.specs.length; i++) {
      const spec = this.specs[i];
      const base = i * N;
      if (spec.parent !== undefined) {
        const r = base * 3;
        const f = spec.parent * 3;
        for (let c = 0; c < 3; c++) {
          p[r + c] = p[f + c];
          q[r + c] = q[f + c];
        }
      }
      for (let k = 1; k < N; k++) {
        const o = (base + k) * 3;
        const x = p[o];
        const y = p[o + 1];
        const z = p[o + 2];
        if (fresh) {
          waterAt(x, y, z, t, water, 0.9, this.lag[i], this.pace[i]);
          sampled[o] = water[0];
          sampled[o + 1] = water[1];
          sampled[o + 2] = water[2];
        } else {
          water[0] = sampled[o];
          water[1] = sampled[o + 1];
          water[2] = sampled[o + 2];
        }
        let vx = (x - q[o]) / dt;
        let vy = (y - q[o + 1]) / dt;
        let vz = (z - q[o + 2]) / dt;
        // Never faster than a strong swell carries it, unless held: a plant may swing far but never whip.
        const fast = Math.hypot(vx, vy, vz);
        if (fast > MOST_SPEED && this.hold?.chain !== i) {
          const k = MOST_SPEED / fast;
          vx *= k;
          vy *= k;
          vz *= k;
        }
        this.stream[o] += (water[0] - vx - this.stream[o]) * smooth;
        this.stream[o + 1] += (water[1] - vy - this.stream[o + 1]) * smooth;
        this.stream[o + 2] += (water[2] - vz - this.stream[o + 2]) * smooth;
        const along = k / N;
        const drag = dragRoot + (dragTip - dragRoot) * along;
        const lift = spec.lift * (0.9 + along * 1.2);
        q[o] = x;
        q[o + 1] = y;
        q[o + 2] = z;
        p[o] = x + vx * dt + (water[0] - vx) * drag * dt * dt;
        p[o + 1] = y + vy * dt + ((water[1] - vy) * drag + lift) * dt * dt;
        p[o + 2] = z + vz * dt + (water[2] - vz) * drag * dt * dt;
      }
      const length = this.segment[i];
      if (this.hold?.chain === i) this.pull(i, this.hold);
      for (let k = 1; k < N; k++) {
        const o = (base + k) * 3;
        const a = o - 3;
        const dx = p[o] - p[a];
        const dy = p[o + 1] - p[a + 1];
        const dz = p[o + 2] - p[a + 2];
        const f = length / (Math.hypot(dx, dy, dz) || 1);
        const nx = p[a] + dx * f;
        const ny = p[a + 1] + dy * f;
        const nz = p[a + 2] + dz * f;
        // The correction moves the previous point with it, so following does not turn into speed.
        q[o] += (nx - p[o]) * 0.9;
        q[o + 1] += (ny - p[o + 1]) * 0.9;
        q[o + 2] += (nz - p[o + 2]) * 0.9;
        p[o] = nx;
        p[o + 1] = ny;
        p[o + 2] = nz;
        if (p[o + 1] > this.ceiling) {
          q[o + 1] += this.ceiling - p[o + 1];
          p[o + 1] = this.ceiling;
        }
        const ground = this.ground(p[o], p[o + 2]) + 0.03;
        if (p[o + 1] < ground) {
          q[o + 1] += ground - p[o + 1];
          p[o + 1] = ground;
        }
      }
    }
  }

  // Drawn toward the hand: the held point eased toward it, and the chain from there back to the root laid along the
  // way to it, each point its own length from the next. Following out from the root afterwards puts the root back,
  // so a pull too far for the chain to reach leaves it stretched straight toward the hand.
  private pull(i: number, hold: Hold) {
    const p = this.position;
    const q = this.previous;
    const N = this.nodes;
    const length = this.segment[i];
    const o = (i * N + hold.node) * 3;
    const ease = [hold.target.x - p[o], hold.target.y - p[o + 1], hold.target.z - p[o + 2]];
    for (let c = 0; c < 3; c++) {
      p[o + c] += ease[c] * 0.25;
      q[o + c] += ease[c] * 0.25 * 0.85;
    }
    for (let k = hold.node - 1; k >= 1; k--) {
      const a = (i * N + k) * 3;
      const b = a + 3;
      const dx = p[a] - p[b];
      const dy = p[a + 1] - p[b + 1];
      const dz = p[a + 2] - p[b + 2];
      const f = length / (Math.hypot(dx, dy, dz) || 1);
      const nx = p[b] + dx * f;
      const ny = p[b + 1] + dy * f;
      const nz = p[b + 2] + dz * f;
      q[a] += (nx - p[a]) * 0.9;
      q[a + 1] += (ny - p[a + 1]) * 0.9;
      q[a + 2] += (nz - p[a + 2]) * 0.9;
      p[a] = nx;
      p[a + 1] = ny;
      p[a + 2] = nz;
    }
  }

  // The point nearest the eye that lies within reach of a ray, as [chain, node, distance along the ray], or null.
  nearest(ray: THREE.Ray, reach: number): [number, number, number] | null {
    const s = this.shown;
    const o = ray.origin;
    const d = ray.direction;
    let best: [number, number, number] | null = null;
    for (let i = 0; i < this.specs.length; i++)
      for (let k = 1; k < this.nodes; k++) {
        const a = (i * this.nodes + k) * 3;
        const x = s[a] - o.x;
        const y = s[a + 1] - o.y;
        const z = s[a + 2] - o.z;
        const along = x * d.x + y * d.y + z * d.z;
        if (along < 0.3 || (best && along >= best[2])) continue;
        // A little more reach the farther it is, so far things can still be caught.
        const r = reach * (1 + along * 0.03);
        if (x * x + y * y + z * z - along * along < r * r) best = [i, k, along];
      }
    return best;
  }
}
