import * as THREE from "three/webgpu";
import { flow } from "./water";

// Stirrings of the water, shared by everything that moves in it: the pointer's line through the scene moving sideways,
// or a burst out from a point. Each fades over a couple of seconds.
export type Stir = { origin: THREE.Vector3; dir: THREE.Vector3; sweep: THREE.Vector3; burst: number; at: THREE.Vector3; age: number };

export const stirs: Stir[] = [];

export function stir(s: Omit<Stir, "age">) {
  stirs.push({ ...s, age: 0 });
  if (stirs.length > 24) stirs.shift();
}

export function ageStirs(delta: number) {
  for (const s of stirs) s.age += delta;
  for (let i = stirs.length - 1; i >= 0; i--) if (stirs[i].age > 2.5) stirs.splice(i, 1);
}

const toP = new THREE.Vector3();

// The water's speed at a point: the swell, current and eddies, plus whatever the stirrings add, capped so that however
// hard the stirring, the water it moves goes no faster than a strong surge.
export function waterAt(x: number, y: number, z: number, t: number, out: Float32Array, cap = 0.9, lag = 0, pace = 1) {
  flow(x, y, z, t, out, 0, lag, pace);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const s of stirs) {
    const fade = Math.exp(-s.age * 1.6);
    if (s.burst > 0) {
      toP.set(x - s.at.x, y - s.at.y, z - s.at.z);
      const d = toP.length() + 1e-4;
      const push = (s.burst * fade * Math.exp(-(d * d) / 2.2)) / d;
      sx += toP.x * push;
      sy += toP.y * push;
      sz += toP.z * push;
    } else {
      toP.set(x - s.origin.x, y - s.origin.y, z - s.origin.z);
      const along = toP.dot(s.dir);
      if (along <= 0) continue;
      const off = toP.addScaledVector(s.dir, -along).length();
      const reach = 0.45 + along * 0.05;
      const weight = Math.exp(-(off * off) / (reach * reach)) * fade * Math.min(along, 5);
      sx += s.sweep.x * weight;
      sy += s.sweep.y * weight;
      sz += s.sweep.z * weight;
    }
  }
  const stirred = Math.hypot(sx, sy, sz);
  const k = stirred > cap ? cap / stirred : 1;
  out[0] += sx * k;
  out[1] += sy * k;
  out[2] += sz * k;
}
