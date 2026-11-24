
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { abs, attribute, cos, cross, float, max, mix, normalize, positionGeometry, sin, smoothstep, transformNormalToView, uniform, varying, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { useDispose } from "./engine/dispose";
import { lehmer } from "./engine/random";
import type { Chains } from "./chains";
import type { Stone } from "./floor";
import { floorAt, inClearing, type Plant } from "./kelp";
import { underSea } from "./shade";
import { sea } from "./water";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Sugar kelp and finger kelp as drawn: each plant one long blade, a chain of points (chains.ts) drawn as a smooth ribbon
// through them, its flat side kept square to a level direction of its own so it never flips. Sugar kelp is long and
// broad with deeply ruffled edges that ripple as the water runs along them; finger kelp is broad and split into
// straps. Every length between two nodes is one instance, curved through its neighbours, so the ribbon is smooth.

export type Blade = { length: number; width: number; kind: 0 | 1; ref: THREE.Vector3; phase: number };

export function Ribbons({ chains, blades, colour, fine, active }: { chains: Chains; blades: Blade[]; colour: string; fine: number; active: boolean }) {
  const tint = useMemo(() => uniform(new THREE.Color(colour)), []);
  tint.value.set(colour);
  const built = useMemo(() => {
    const N = chains.nodes;
    const segments = blades.length * (N - 1);
    const along = fine > 0.8 ? 3 : 2;
    const across = fine > 0.8 ? 4 : 3;
    const points: number[] = [];
    const index: number[] = [];
    for (let a = 0; a <= along; a++) for (let c = 0; c <= across; c++) points.push(a / along, (c / across) * 2 - 1, 0);
    for (let a = 0; a < along; a++)
      for (let c = 0; c < across; c++) {
        const i = a * (across + 1) + c;
        const j = i + across + 1;
        index.push(i, j, i + 1, i + 1, j, j + 1);
      }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    geometry.setIndex(index);
    // Rewritten whole every frame and sent once: left at the usual usage, as three's WebGPU backend sends an attribute
    // marked dynamic again for every pass it is drawn in, whether or not it has changed since.
    const ends = ["aP0", "aP1", "aP2", "aP3"].map((name) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(segments * 4), 4);
      geometry.setAttribute(name, a);
      return a;
    });
    const ref = new Float32Array(segments * 4);
    const size = new Float32Array(segments * 4);
    blades.forEach((b, i) => {
      for (let k = 0; k < N - 1; k++) {
        const o = (i * (N - 1) + k) * 4;
        ref.set([b.ref.x, b.ref.y, b.ref.z, b.phase], o);
        size.set([b.length, b.width, b.kind, k], o);
      }
    });
    geometry.setAttribute("aRef", new THREE.InstancedBufferAttribute(ref, 4));
    geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 4));
    geometry.instanceCount = segments;

    // The ribbon at (t along this length, w across), and its normal.
    const ribbon = () => {
      const [P0, P1, P2, P3] = ["aP0", "aP1", "aP2", "aP3"].map((n) => attribute(n, "vec4") as any);
      const R = attribute("aRef", "vec4") as any;
      const S = attribute("aSize", "vec4") as any;
      const t = positionGeometry.x as any;
      const w = positionGeometry.y as any;
      const a = P1.xyz.mul(2) as any;
      const b = P2.xyz.sub(P0.xyz) as any;
      const c = P0.xyz.mul(2).sub(P1.xyz.mul(5)).add(P2.xyz.mul(4)).sub(P3.xyz) as any;
      const d = P1.xyz.mul(3).sub(P0.xyz).sub(P2.xyz.mul(3)).add(P3.xyz) as any;
      const centre = a.add(b.mul(t)).add(c.mul(t.mul(t))).add(d.mul(t.mul(t).mul(t))).mul(0.5) as any;
      const T = normalize(b.add(c.mul(t.mul(2))).add(d.mul(t.mul(t).mul(3))).add(vec3(0, 1e-5, 0))) as any;
      const u = mix(P1.w, P2.w, t) as any;
      const L = S.x as any;
      const phase = R.w as any;
      const finger = S.z as any;
      // Square to the plant's own level direction, turned slowly along the blade. A little of the level way across the
      // blade is added so the side never runs out when the blade streams along that direction: it turns smoothly
      // rather than flipping over, which showed as a twitch.
      let side: any = normalize(R.xyz.sub(T.mul(R.xyz.dot(T))).add(vec3(T.z.negate(), 0, T.x).mul(0.3)).add(vec3(1e-4, 0, 0)));
      let N: any = cross(T, side);
      const twist = sin(u.mul(3.1).add(phase).add(sea.clock.mul(0.35))).mul(0.55) as any;
      const s2 = side.mul(cos(twist)).add(N.mul(sin(twist))) as any;
      N = N.mul(cos(twist)).sub(side.mul(sin(twist)));
      side = s2;
      // A short round stipe, then the blade: broad soon, tapering to a frayed tip.
      const stalk = float(0.07) as any;
      const blade = smoothstep(stalk, stalk.add(0.1), u) as any;
      const tip = float(1).sub(smoothstep(0.7, 1, u).mul(0.75)) as any;
      const W = mix(float(0.008), S.y.mul(tip).mul(mix(float(1), float(1.25), finger)), blade) as any;
      // Ruffles: deep near the edges and flat down the middle, running slowly along the blade as the water passes.
      const freq = L.mul(mix(float(13), float(4), finger)) as any;
      const wave = u.mul(freq).add(phase.mul(5)).sub(sea.clock.mul(1.1)) as any;
      const edge = w.mul(w).mul(w.mul(w)) as any;
      const deep = W.mul(mix(float(0.55), float(0.2), finger)).mul(blade) as any;
      const bulge = deep.mul(edge).mul(sin(wave)) as any;
      // Down the middle a shallow rib, pocked a little.
      const rib = W.mul(0.06).mul(float(1).sub(abs(w)).max(0)).mul(sin(u.mul(L).mul(40)).mul(0.3).add(1)) as any;
      const position = centre.add(side.mul(w.mul(W))).add(N.mul(bulge.add(rib)));
      const dW = deep.mul(w.mul(w).mul(w).mul(4)).mul(sin(wave)) as any;
      const dU = deep.mul(edge).mul(cos(wave)).mul(freq) as any;
      const normal = normalize(N.sub(side.mul(dW.div(max(W, 0.004)))).sub(T.mul(dU.div(max(L, 0.1)))));
      return { position, normal, u, w, finger };
    };
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, side: THREE.DoubleSide });
    // Built once, so the vertex shader works the ribbon out once for its position, normal and place along it.
    const shaped = ribbon();
    material.positionNode = shaped.position;
    const normal = varying(shaped.normal) as any;
    material.normalNode = transformNormalToView(normal) as any;
    const coords = varying(vec3(shaped.u, positionGeometry.y, attribute("aSize", "vec4").z)) as any;
    const u = coords.x as any;
    const w = coords.y as any;
    // Darker and thicker down the middle, pale and thin at the ruffled edges, finely streaked.
    const streak = sin(w.mul(41).add(sin(u.mul(13)).mul(2))).mul(0.05).add(0.97) as any;
    const middle = mix(float(0.72), float(1.12), smoothstep(0.2, 0.95, abs(w))) as any;
    const base = mix(float(0.55), float(1.05), smoothstep(0.02, 0.3, u)) as any;
    const tone = (tint as any).mul(streak).mul(middle).mul(base) as any;
    material.colorNode = tone;
    underSea(material, tone, { normal, through: tone.mul(vec3(1.35, 1.05, 0.5)).mul(1.1), caustics: "vertex" });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return { mesh, material, ends };
  }, [chains, blades, fine, tint]);
  useDispose(built.mesh.geometry, built.material);

  useFrame(() => {
    if (!active) return;
    const N = chains.nodes;
    const p = chains.shown;
    const [e0, e1, e2, e3] = built.ends.map((a) => a.array as Float32Array);
    let n = 0;
    for (let i = 0; i < blades.length; i++) {
      const first = i * N;
      for (let k = 0; k < N - 1; k++) {
        const o = n * 4;
        const q0 = (first + Math.max(0, k - 1)) * 3;
        const q1 = (first + k) * 3;
        const q2 = (first + k + 1) * 3;
        const q3 = (first + Math.min(N - 1, k + 2)) * 3;
        for (let c = 0; c < 3; c++) {
          e0[o + c] = p[q0 + c];
          e1[o + c] = p[q1 + c];
          e2[o + c] = p[q2 + c];
          e3[o + c] = p[q3 + c];
        }
        e1[o + 3] = k / (N - 1);
        e2[o + 3] = (k + 1) / (N - 1);
        n++;
      }
    }
    built.ends.forEach((a) => (a.needsUpdate = true));
  });

  return <primitive object={built.mesh} />;
}

// Where the kelp grows: mostly on the rocks, some on the cobbles between, never in the eye's way.
export function plantKelp(stones: Stone[], fine: number, avoid: Plant[] = []) {
  const random = lehmer(6197);
  const count = Math.round(55 * fine);
  const big = stones.filter((s) => s.size > 0.45);
  const plants: Plant[] = [];
  const blades: Blade[] = [];
  const specs: ConstructorParameters<typeof Chains>[0] = [];
  for (let tries = 0; plants.length < count && tries < count * 30; tries++) {
    let x: number;
    let z: number;
    let y: number;
    if (random() < 0.6 && big.length) {
      const s = big[Math.floor(random() * big.length)];
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * s.size * 0.45;
      x = s.x + Math.cos(a) * r;
      z = s.z + Math.sin(a) * r;
      y = s.y + s.size * 0.82 * Math.sqrt(Math.max(0, 1 - (r / (s.size * 0.55)) ** 2)) - s.size * 0.18;
    } else {
      const a = random() * Math.PI * 2;
      const r = 0.8 + Math.pow(random(), 0.8) * 14;
      x = Math.cos(a) * r + 0.5;
      z = Math.sin(a) * r + 1.5;
      y = floorAt(x, z);
    }
    // Clear of the eye's start, low in the grass, so the first view looks past them rather than into a blade.
    if (Math.hypot(x - 0.9, z - 7.4) < 2.8) continue;
    if (inClearing(x, z)) continue;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 0.5)) continue;
    const finger = random() < 0.12;
    const length = finger ? 1.1 + random() * 0.7 : 1.8 + random() * 1.6;
    const width = finger ? 0.16 + random() * 0.08 : 0.08 + random() * 0.08;
    plants.push({ x, z, y, size: 0.5 });
    const a = random() * Math.PI * 2;
    blades.push({ length, width, kind: finger ? 1 : 0, ref: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), phase: random() * 100 });
    specs.push({ root: new THREE.Vector3(x, y + 0.02, z), length, lift: finger ? 0.3 : 0.03 + random() ** 2 * 0.22, lean: new THREE.Vector3(random() - 0.5, 1.2, random() - 0.5) });
  }
  return { plants, blades, specs };
}

// Little kelps in patches: dozens of short young blades crowded together on the rocks and the sand between, as they
// come up where the light reaches the floor.
export function plantPatches(stones: Stone[], fine: number, avoid: Plant[] = []) {
  const random = lehmer(8221);
  const big = stones.filter((s) => s.size > 0.4);
  const plants: Plant[] = [];
  const blades: Blade[] = [];
  const specs: ConstructorParameters<typeof Chains>[0] = [];
  const patches = Math.round(14 * fine);
  for (let n = 0; n < patches; n++) {
    let cx: number;
    let cz: number;
    if (random() < 0.5 && big.length) {
      const s = big[Math.floor(random() * big.length)];
      cx = s.x;
      cz = s.z;
    } else {
      const a = random() * Math.PI * 2;
      const r = 1 + Math.pow(random(), 0.8) * 13;
      cx = Math.cos(a) * r + 0.5;
      cz = Math.sin(a) * r + 2;
    }
    const wide = 0.35 + random() * 0.6;
    const count = Math.round((4 + random() * 6) * (0.5 + fine * 0.5));
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * wide;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (Math.hypot(x - 0.9, z - 7.4) < 2.1) continue;
      if (inClearing(x, z)) continue;
      if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 0.35)) continue;
      // On the rock if it lies on one.
      let y = floorAt(x, z);
      for (const s of stones) {
        const d = Math.hypot(s.x - x, s.z - z) / (s.size * 0.6);
        if (d < 1) y = Math.max(y, s.y + s.size * 0.75 * Math.sqrt(1 - d * d) - s.size * 0.15);
      }
      const finger = random() < 0.15;
      const length = (finger ? 0.35 : 0.45) + random() * (finger ? 0.35 : 0.8) * (1 - r / wide / 2);
      plants.push({ x, z, y, size: 0.3 });
      const turn = random() * Math.PI * 2;
      blades.push({ length, width: finger ? 0.07 + random() * 0.04 : 0.035 + random() * 0.035, kind: finger ? 1 : 0, ref: new THREE.Vector3(Math.cos(turn), 0, Math.sin(turn)), phase: random() * 100 });
      specs.push({ root: new THREE.Vector3(x, y + 0.01, z), length, lift: finger ? 0.4 : 0.08 + random() * 0.3, lean: new THREE.Vector3(random() - 0.5, 1.4, random() - 0.5) });
    }
  }
  return { plants, blades, specs };
}
