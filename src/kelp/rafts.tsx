
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Fn, abs, attribute, cameraPosition, color, cos, float, length, max, mix, mod, mx_noise_float, normalize, positionGeometry, positionWorld, sin, smoothstep, transformNormalToView, varying, vec2, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { useDispose } from "./engine/dispose";
import { lehmer } from "./engine/random";
import { underSea } from "./shade";
import { waterAt } from "./stir";
import { SURFACE, SWELL, flow, sea, through } from "./water";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Rafts of sargassum floating at the surface over the kelp forest: golden weed buoyed by its floats, riding the waves.

// --- The weed ---

// A clump of sargassum, hanging from the surface (y = 0 at the top, growing down and out, about a metre across at size
// one): branching stems, small toothed blades all along them, and clusters of round floats near the tips. Each vertex
// carries which part it belongs to, for its colour.
function clumpShape(salt: number, fine: number) {
  const random = lehmer(salt);
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, part: number) => {
    // Kept indexed, which shares every vertex between its faces.
    const bare = new THREE.BufferGeometry();
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    bare.setAttribute("position", g.getAttribute("position"));
    bare.setAttribute("normal", g.getAttribute("normal"));
    bare.setAttribute("aPart", new THREE.Float32BufferAttribute(new Array(g.getAttribute("position").count).fill(part), 1));
    bare.setIndex(g.getIndex());
    parts.push(bare);
  };
  const sides = fine > 0.8 ? 5 : 4;
  const up = new THREE.Vector3(0, 1, 0);

  // A toothed blade, flat, from its base along +x, then turned into place.
  const blade = (at: THREE.Vector3, dir: THREE.Vector3, long: number, wide: number) => {
    const pts: number[] = [];
    const segs = 2;
    const side = new THREE.Vector3().crossVectors(dir, up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const lift = new THREE.Vector3().crossVectors(side, dir).normalize();
    // A little curl along the blade.
    const curl = (random() - 0.5) * 0.6;
    const point = (u: number, w: number) => {
      const tooth = 1 + 0.35 * Math.abs(Math.sin(u * Math.PI * 6));
      const width = wide * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.7 * tooth * w;
      return at
        .clone()
        .addScaledVector(dir, long * u)
        .addScaledVector(side, width)
        .addScaledVector(lift, curl * long * u * u + Math.abs(w) * wide * 0.25);
    };
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      pts.push(...point(u, -1).toArray(), ...point(u, 0).toArray(), ...point(u, 1).toArray());
      if (i < segs) {
        const k = i * 3;
        idx.push(k, k + 1, k + 3, k + 1, k + 4, k + 3, k + 1, k + 2, k + 4, k + 2, k + 5, k + 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    tag(g, 1);
  };

  // A float: a small round bladder on a short stalk.
  const float_ = (at: THREE.Vector3, dir: THREE.Vector3, r: number) => {
    const end = at.clone().addScaledVector(dir, r * 1.6);
    tag(new THREE.TubeGeometry(new THREE.LineCurve3(at, end), 1, r * 0.18, 3, false), 0);
    tag(new THREE.SphereGeometry(r, 6, 4).translate(end.x, end.y, end.z), 2);
  };

  // Stems, wandering down and out, forking, dressed as they go.
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, long: number, radius: number, depth: number) => {
    const pts = [from.clone()];
    let p = from.clone();
    let d = dir.clone();
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      d.add(new THREE.Vector3((random() - 0.5) * 0.5, (random() - 0.55) * 0.3, (random() - 0.5) * 0.5)).normalize();
      p = p.clone().addScaledVector(d, long / steps);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    tag(new THREE.TubeGeometry(curve, fine > 0.8 ? 8 : 5, radius, sides, false), 0);
    // Blades along the stem, alternating, and floats in the axils near the end.
    const leaves = Math.round(3 * long * 4);
    for (let i = 0; i < leaves; i++) {
      const u = 0.12 + (i / leaves) * 0.86;
      const at = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const out = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).cross(t).normalize();
      const leafDir = t.clone().multiplyScalar(0.5).add(out).normalize();
      blade(at, leafDir, 0.05 + random() * 0.045, 0.009 + random() * 0.007);
      if (u > 0.3 && random() < 0.5) float_(at, out.clone().negate().add(t.clone().multiplyScalar(0.3)).normalize(), 0.006 + random() * 0.005);
    }
    if (depth > 0) {
      const forks = 2;
      for (let i = 0; i < forks; i++) {
        const u = 0.35 + random() * 0.6;
        const at = curve.getPointAt(u);
        const branch = curve
          .getTangentAt(u)
          .add(new THREE.Vector3((random() - 0.5) * 1.6, (random() - 0.6) * 0.8, (random() - 0.5) * 1.6))
          .normalize();
        grow(at, branch, long * (0.55 + random() * 0.2), radius * 0.75, depth - 1);
      }
    } else {
      // A cluster of floats at the tip.
      const tip = curve.getPointAt(1);
      for (let i = 0; i < 5; i++) float_(tip, new THREE.Vector3(random() - 0.5, random() - 0.6, random() - 0.5).normalize(), 0.006 + random() * 0.004);
    }
  };

  const stems = fine > 0.8 ? 9 : 6;
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + random() * 0.6;
    // Some spread along the surface, some hang down.
    const fall = 0.2 + random() * 0.9;
    grow(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(Math.cos(a), -fall, Math.sin(a)).normalize(), 0.3 + random() * 0.2, 0.0055, 1);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

// Rafts and windrows: clumps gathered in long bands across the surface, as wind and current line them up, and loose
// clumps between. Each bobs on the swell, tilts with the waves under it, and is pushed about by stirred water, springing
// back as it drifts.
type Clump = { x: number; z: number; size: number; turn: number; variant: number };

function placeClumps(count: number) {
  const random = lehmer(31337);
  const out: Clump[] = [];
  const rows = [
    // a point on the band, its direction, its length and width
    [0.5, 3, 0.3, 18, 2.4],
    [1, 6.5, -0.15, 16, 2.8],
    [-3, -3, -0.25, 22, 3],
    [5, -6, 0.6, 16, 2],
    [-6, 9, 0.1, 14, 1.6],
    [3, 12, -0.5, 20, 2.6],
    [-10, -9, 0.9, 16, 2.2]
  ];
  while (out.length < count) {
    const loose = random() < 0.1;
    let x: number;
    let z: number;
    if (loose) {
      x = (random() - 0.5) * 36;
      z = (random() - 0.5) * 36;
    } else {
      const [cx, cz, angle, long, wide] = rows[Math.floor(random() * rows.length)];
      const along = (random() - 0.5) * long;
      // Thick in the middle of the band, ragged at its edges.
      const across = (random() + random() + random() - 1.5) * wide * 0.5 + Math.sin(along * 0.4) * 1.2;
      x = cx + Math.cos(angle) * along - Math.sin(angle) * across;
      z = cz + Math.sin(angle) * along + Math.cos(angle) * across;
    }
    out.push({ x, z, size: 2 + random() * 2.2, turn: random() * Math.PI * 2, variant: Math.floor(random() * 3) });
  }
  return out;
}

// The height and slope of the surface at a point, from the same swell and the two longest crossing waves the surface is
// drawn with, so the weed rides the waves it is seen on.
const CHOP: [number, number, number, number, number][] = [
  [0.6, -0.8, 0.9, 1.1, 0.07],
  [-0.3, 1, 1.7, 1.6, 0.045],
  [0.9, 0.45, 3.3, 2.3, 0.022]
];
const surfaceAt = (xz: any) => {
  const t = sea.clock as any;
  const phase = xz.x.mul(SWELL.x).add(xz.y.mul(SWELL.y)).mul(sea.waveK).sub(sea.surge) as any;
  const tall = sea.swell.mul(0.12) as any;
  let h: any = cos(phase).mul(tall);
  let g: any = vec2(SWELL.x, SWELL.y).mul(sin(phase).mul(tall).mul(sea.waveK).negate());
  CHOP.forEach(([dx, dz, k, w, a], i) => {
    const d = vec2(dx, dz).normalize() as any;
    const p = xz.dot(d).mul(k).sub(t.mul(w)).add(i * 1.7) as any;
    const amp = sea.swell.mul(0.5).add(0.6).mul(a) as any;
    h = h.add(sin(p).mul(amp));
    g = g.add(d.mul(cos(p).mul(amp).mul(k)));
  });
  return { h, g };
};

const WRAP = 44;
const wrap = (v: number) => ((((v + WRAP / 2 - 1) % WRAP) + WRAP) % WRAP) - (WRAP / 2 - 1);

export function Rafts({ fine, active }: { fine: number; active: boolean }) {
  const built = useMemo(() => {
    const clumps = placeClumps(Math.round(45 * fine));
    const shapes = [0, 1, 2].map((v) => clumpShape(911 + v * 77, fine));
    const meshes = shapes.map((shape, variant) => {
      const mine = clumps.filter((c) => c.variant === variant);
      const geometry = new THREE.InstancedBufferGeometry();
      for (const n of ["position", "normal", "aPart"]) geometry.setAttribute(n, shape.getAttribute(n));
      const at = new Float32Array(mine.length * 4);
      mine.forEach((c, i) => at.set([c.x, c.z, c.size, c.turn], i * 4));
      geometry.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 4));
      // Rewritten whole every frame and sent once: left at the usual usage, as three's WebGPU backend sends an attribute
      // marked dynamic again for every pass it is drawn in, whether or not it has changed since.
      const push = new THREE.InstancedBufferAttribute(new Float32Array(mine.length * 3), 3);
      geometry.setAttribute("aPush", push);
      geometry.instanceCount = mine.length;

      const A = attribute("aAt", "vec4") as any;
      const Q = attribute("aPush", "vec3") as any;
      const spin = (v: any) => vec3(v.x.mul(cos(A.w)).sub(v.z.mul(sin(A.w))), v.y, v.x.mul(sin(A.w)).add(v.z.mul(cos(A.w)))) as any;
      // Carried along by the current and brought round again far off in the haze, so the rafts never run out.
      const here = mod(A.xy.add(sea.carried).add(WRAP / 2 - 1), WRAP).sub(WRAP / 2 - 1) as any;
      const pose = (local: any, normal: any) => {
        const s = surfaceAt(here);
        // Shrunk to nothing toward the far edges where it wraps, so none is ever seen to pop round.
        const edge = smoothstep(WRAP / 2, WRAP / 2 - 4, max(abs(here.x.sub(1)), abs(here.y.sub(1)))) as any;
        const turned = spin(local).mul(A.z).mul(edge) as any;
        const deep = local.y.negate().mul(A.z).max(0) as any;
        // Tilted with the wave under it, the hanging parts trailing in the water and swaying a little.
        const tilt = turned.x.mul(s.g.x.negate()).add(turned.z.mul(s.g.y.negate())) as any;
        const seed = A.x.mul(1.3).add(A.y.mul(0.7)) as any;
        const sway = vec3(sin(sea.clock.mul(0.8).add(seed).sub(deep.mul(3))), 0, cos(sea.clock.mul(0.65).add(seed.mul(1.7)).sub(deep.mul(3)))).mul(deep.mul(0.08)) as any;
        const pushed = Q.mul(deep.mul(1.6).add(0.35)) as any;
        const top = vec3(here.x, s.h.add(SURFACE - 0.03), here.y) as any;
        const position = top.add(turned).add(vec3(0, tilt, 0)).add(sway).add(pushed);
        return { position, normal: normalize(spin(normal)) };
      };
      const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, side: THREE.DoubleSide });
      const posed = pose(positionGeometry, attribute("normal", "vec3"));
      material.positionNode = posed.position;
      const normal = varying(posed.normal) as any;
      material.normalNode = transformNormalToView(normal) as any;
      const part = varying(attribute("aPart", "float")) as any;
      const local = varying(positionGeometry) as any;
      // Stems dark amber, blades golden and a little mottled, floats paler and glossier.
      const mottle = mx_noise_float(local.mul(60)).mul(0.18).add(0.92) as any;
      const stem = color("#4a2e0c") as any;
      const leaf = mix(color("#7a4e12"), color("#a8701e"), mx_noise_float(local.mul(9).add(A.x)).mul(0.5).add(0.5)).mul(mottle) as any;
      const floatColour = color("#b58830") as any;
      const tone = mix(mix(stem, leaf, smoothstep(0.5, 0.6, part)), floatColour, smoothstep(1.5, 1.6, part)) as any;
      material.colorNode = tone;
      underSea(material, tone, { normal, caustics: "vertex", through: tone.mul(vec3(1.6, 1.05, 0.35)).mul(1.5) });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      return { mesh, push, mine };
    });
    shapes.forEach((s) => s.dispose());
    return meshes;
  }, [fine]);
  useDispose(...built.flatMap((b) => [b.mesh.geometry, b.mesh.material as THREE.Material]));

  // Each clump's push from stirred water: the water's speed less the swell's, carried along and springing back.
  const scratch = useMemo(() => ({ water: new Float32Array(3), swell: new Float32Array(3), offset: built.map((b) => new Float32Array(b.mine.length * 3)), speed: built.map((b) => new Float32Array(b.mine.length * 3)) }), [built]);
  useFrame((_, raw) => {
    if (!active) return;
    const dt = Math.min(raw, 1 / 20);
    const t = sea.clock.value;
    built.forEach((b, n) => {
      const off = scratch.offset[n];
      const vel = scratch.speed[n];
      const arr = b.push.array as Float32Array;
      b.mine.forEach((c, i) => {
        const o = i * 3;
        const x = wrap(c.x + sea.carried.value.x) + off[o];
        const z = wrap(c.z + sea.carried.value.y) + off[o + 2];
        waterAt(x, SURFACE - 0.3, z, t, scratch.water);
        flow(x, SURFACE - 0.3, z, t, scratch.swell);
        for (let k = 0; k < 3; k++) {
          const stirred = scratch.water[k] - scratch.swell[k];
          // Dragged toward the stirred water's speed, and held back to where it lay by a soft spring.
          vel[o + k] += ((stirred - vel[o + k]) * 3 - off[o + k] * 0.6) * dt;
          off[o + k] += vel[o + k] * dt;
        }
        off[o + 1] = Math.max(-0.4, Math.min(0.05, off[o + 1]));
        arr[o] = off[o];
        arr[o + 1] = off[o + 1];
        arr[o + 2] = off[o + 2];
      });
      b.push.needsUpdate = true;
    });
  });

  return (
    <>
      {built.map((b, i) => (
        <primitive key={i} object={b.mesh} />
      ))}
    </>
  );
}

// --- The light ---

