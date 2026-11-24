
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { abs, attribute, cameraPosition, color, cos, cross, float, max, mix, mx_noise_float, normalize, positionGeometry, positionWorld, sin, smoothstep, transformNormalToView, uniform, varying, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { useDispose } from "./engine/dispose";
import { lehmer } from "./engine/random";
import { NODES, type Forest } from "./kelp";
import { underSea } from "./shade";
import { SURFACE, sea } from "./water";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Merged from position and normal only, whatever else each part carries.
function merge(parts: THREE.BufferGeometry[]) {
  const bare = parts.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", p.getAttribute("position"));
    if (!p.getAttribute("normal")) p.computeVertexNormals();
    g.setAttribute("normal", p.getAttribute("normal"));
    if (p.getIndex()) g.setIndex(p.getIndex());
    return g.getIndex() ? g.toNonIndexed() : g;
  });
  return mergeGeometries(bare);
}

// The kelp as drawn: stipes as smooth tubes through the simulated points, a ruffled, corrugated blade on a float at
// every node, and a tangle of holdfast at each root. Four draws for the near plants and four for the far.

// The plants close in front of the start are drawn in fine detail, the ones out in the haze, never come near, coarsely:
// two sets of the same pieces, sharing the materials.
export function Kelp({ forest, blade, stipe, fine, active }: { forest: Forest; blade: string; stipe: string; fine: number; active: boolean }) {
  const sets = useMemo(() => [build(forest, fine, true), build(forest, fine, false)], [forest, fine]);
  const colours = useMemo(() => ({ blade: uniform(new THREE.Color(blade)), stipe: uniform(new THREE.Color(stipe)) }), []);
  colours.blade.value.set(blade);
  colours.stipe.value.set(stipe);
  const looks = useMemo(() => materials(colours), [colours]);
  const meshes = useMemo(() => sets.map((built) => meshesOf(built, looks)), [sets, looks]);
  useDispose(...sets.flatMap((b) => [b.tube, b.leaf, b.float, b.roots]), looks.stipe, looks.blade, looks.float, looks.root);

  // Every instanced piece's per-frame data is filled from the forest here, once a frame.
  useFrame(() => {
    if (!active) return;
    for (const built of sets) fill(forest, built);
  });

  return (
    <>
      {meshes.flatMap((m, i) => [m.stipes, m.blades, m.floats, m.roots].map((o, j) => <primitive key={i * 4 + j} object={o} />))}
    </>
  );
}

type Built = ReturnType<typeof build>;

// The first four plants stand in front of the start (see kelp.ts).
const NEAR = 4;

function build(forest: Forest, fine: number, near: boolean) {
  const random = lehmer(near ? 9173 : 9174);
  const stipes = forest.stipes.flatMap((s, i) => ((s.plant < NEAR) === near ? [i] : []));
  const segments = stipes.length * (NODES - 1);
  // The stipe: a tube of rings along each length between nodes, x the way along and y the way round.
  const rings = near ? (fine > 0.8 ? 3 : 2) : 2;
  const sides = near ? 5 : 4;
  const tubePoints: number[] = [];
  const tubeIndex: number[] = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= sides; s++) tubePoints.push(r / rings, (s / sides) * Math.PI * 2, 0);
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < sides; s++) {
      const a = r * (sides + 1) + s;
      const b = a + sides + 1;
      tubeIndex.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const tube = new THREE.InstancedBufferGeometry();
  tube.setAttribute("position", new THREE.Float32BufferAttribute(tubePoints, 3));
  tube.setIndex(tubeIndex);
  // Rewritten whole every frame and sent once: left at the usual usage, as three's WebGPU backend sends an attribute
  // marked dynamic again for every pass it is drawn in, whether or not it has changed since.
  const ends = ["aP0", "aP1", "aP2", "aP3"].map((name) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(segments * 4), 4);
    tube.setAttribute(name, a);
    return a;
  });
  tube.instanceCount = segments;

  // Blades: one at each node above the first few, each a strip x along and y across.
  const perNode = 1;
  const sites: { stipe: number; node: number; length: number; width: number; phase: number; cx: number; cz: number }[] = [];
  stipes.forEach((i) => {
    const s = forest.stipes[i];
    for (let k = 2; k < NODES; k++)
      for (let j = 0; j < perNode; j++) {
        // Young stipes carry small blades near their growing tip.
        const tip = k / (NODES - 1);
        const size = s.length < 6 ? 0.55 + 0.45 * (1 - tip) : 1;
        // Round the stipe from node to node, by the golden angle.
        const turn = k * 2.39996 + j * Math.PI + (random() - 0.5) * 0.8;
        sites.push({
          stipe: i,
          node: k,
          length: (0.45 + random() * 0.45) * size,
          width: (0.045 + random() * 0.035) * size,
          phase: random() * 100,
          cx: Math.cos(turn),
          cz: Math.sin(turn)
        });
      }
  });
  const along = near ? (fine > 0.7 ? 6 : 4) : 3;
  const across = near ? 2 : 1;
  const leafPoints: number[] = [];
  const leafIndex: number[] = [];
  for (let a = 0; a <= along; a++) for (let c = 0; c <= across; c++) leafPoints.push(a / along, (c / across) * 2 - 1, 0);
  for (let a = 0; a < along; a++)
    for (let c = 0; c < across; c++) {
      const i = a * (across + 1) + c;
      const j = i + across + 1;
      leafIndex.push(i, j, i + 1, i + 1, j, j + 1);
    }
  const leaf = new THREE.InstancedBufferGeometry();
  leaf.setAttribute("position", new THREE.Float32BufferAttribute(leafPoints, 3));
  leaf.setIndex(leafIndex);
  // Rewritten whole every frame and sent once: left at the usual usage, as three's WebGPU backend sends an attribute
  // marked dynamic again for every pass it is drawn in, whether or not it has changed since.
  const make = (name: string, geometry: THREE.InstancedBufferGeometry) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(sites.length * 4), 4);
    geometry.setAttribute(name, a);
    return a;
  };
  const base = make("aBase", leaf);
  const axis = make("aAxis", leaf);
  const stream = make("aFlow", leaf);
  const out = make("aOut", leaf);
  leaf.instanceCount = sites.length;
  // The floats share the blades' placing.
  const sphere = near ? new THREE.SphereGeometry(1, 5, 4) : new THREE.SphereGeometry(1, 4, 3);
  const float_ = new THREE.InstancedBufferGeometry();
  float_.setAttribute("position", sphere.getAttribute("position"));
  float_.setAttribute("normal", sphere.getAttribute("normal"));
  float_.setIndex(sphere.getIndex());
  for (const [name, a] of [
    ["aBase", base],
    ["aAxis", axis],
    ["aOut", out]
  ] as const)
    float_.setAttribute(name, a);
  float_.instanceCount = sites.length;
  sphere.dispose();
  for (let i = 0; i < sites.length; i++) {
    base.array[i * 4 + 3] = sites[i].length;
    axis.array[i * 4 + 3] = sites[i].phase;
    stream.array[i * 4 + 3] = sites[i].width;
  }

  // Holdfasts, as giant kelp's grow: a cone of root-like haptera climbing the stipes' bases, each one thick where it leaves
  // the bundle and tapering as it arches out and down into the sand, forking twice on the way, so the plant stands on a
  // tangled mound rather than a few sticks. Finely made on the near plants, coarsely on the far.
  const pieces: THREE.BufferGeometry[] = [];
  const ring = near && fine > 0.8 ? 7 : near ? 5 : 4;
  const lengthwise = near && fine > 0.8 ? 12 : near ? 8 : 5;
  const grow = (from: THREE.Vector3, a: number, reach: number, rise: number, r0: number, r1: number, depth: number, plantY: number) => {
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const end = from.clone().addScaledVector(out, reach);
    end.y = plantY - 0.02 - random() * 0.02;
    // A low bulge on the way out and down, hugging the mound rather than standing off it.
    const mid = from.clone().lerp(end, 0.45);
    mid.y += rise;
    const curve = new THREE.CatmullRomCurve3([from, mid, end]);
    pieces.push(taperedTube(curve, Math.max(3, Math.round(lengthwise * (depth === 0 ? 1 : 0.6))), r0, r1, depth === 0 ? ring : Math.max(4, ring - 2)));
    if (depth >= 2) return;
    // Forks partway along, thinner, splaying further out.
    const forks = depth === 0 ? 2 : 1 + Math.floor(random() * 2);
    for (let f = 0; f < forks; f++) {
      const t = 0.4 + random() * 0.3;
      const at = curve.getPoint(t);
      const r = r0 + (r1 - r0) * t;
      grow(at, a + (random() - 0.5) * 1.3, reach * (0.4 + random() * 0.3), rise * 0.4, r * 0.75, Math.max(0.0012, r * 0.25), depth + 1, plantY);
    }
  };
  for (const plant of forest.plants.filter((_, i) => (i < NEAR) === near)) {
    const count = Math.round((near ? 20 + random() * 8 : 8) * plant.size);
    for (let r = 0; r < count; r++) {
      const a = random() * Math.PI * 2;
      // Higher up the bundle, the haptera start closer in and reach further, so the whole makes a cone.
      const up = Math.pow(random(), 1.6);
      const from = new THREE.Vector3(plant.x + Math.cos(a) * (0.05 - up * 0.03), plant.y + 0.01 + up * 0.15 * plant.size, plant.z + Math.sin(a) * (0.05 - up * 0.03));
      const reach = (0.1 + random() * 0.12 + up * 0.12) * plant.size;
      grow(from, a + (random() - 0.5) * 0.4, reach, 0.01 + random() * 0.025, (0.006 + random() * 0.005) * plant.size, 0.0018, 0, plant.y);
    }
  }
  const roots = merge(pieces);
  pieces.forEach((p) => p.dispose());

  return { stipes, tube, ends, leaf, float: float_, base, axis, stream, out, sites, roots };
}

function materials(colours: { blade: any; stipe: any }) {
  // The stipe, along a Catmull-Rom curve through the four points round each length, round in section.
  const stipeAt = () => {
    const [P0, P1, P2, P3] = ["aP0", "aP1", "aP2", "aP3"].map((n) => attribute(n, "vec4") as any);
    const t = positionGeometry.x as any;
    const a = P1.xyz.mul(2) as any;
    const b = P2.xyz.sub(P0.xyz) as any;
    const c = P0.xyz.mul(2).sub(P1.xyz.mul(5)).add(P2.xyz.mul(4)).sub(P3.xyz) as any;
    const d = P1.xyz.mul(3).sub(P0.xyz).sub(P2.xyz.mul(3)).add(P3.xyz) as any;
    const centre = a.add(b.mul(t)).add(c.mul(t.mul(t))).add(d.mul(t.mul(t).mul(t))).mul(0.5) as any;
    const T = normalize(b.add(c.mul(t.mul(2))).add(d.mul(t.mul(t).mul(3))).add(vec3(0, 1e-5, 0))) as any;
    const ref = abs(T.y).greaterThan(0.95).select(vec3(1, 0, 0), vec3(0, 1, 0)) as any;
    const side = normalize(cross(T, ref)) as any;
    const bi = cross(side, T) as any;
    const n = side.mul(cos(positionGeometry.y)).add(bi.mul(sin(positionGeometry.y))) as any;
    const radius = mix(P1.w, P2.w, t) as any;
    return { position: centre.add(n.mul(radius)), normal: n };
  };
  const stipeMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
  // Each shape is built once and its position and normal read from the same nodes, so the vertex shader works it out once.
  const stipe = stipeAt();
  stipeMaterial.positionNode = stipe.position;
  const stipeNormal = varying(stipe.normal) as any;
  stipeMaterial.normalNode = transformNormalToView(stipeNormal) as any;
  const stipeColour = colours.stipe as any;
  stipeMaterial.colorNode = stipeColour;
  underSea(stipeMaterial, stipeColour, { normal: stipeNormal, through: stipeColour.mul(0.3), caustics: "vertex" });

  // A blade: a long tapering strip from its float, curving out from the stipe then streaming the way the water goes past
  // it, fluttering, twisted a little, its edges ruffled and its face pocked in rows, as giant kelp's are.
  const bladeAt = () => {
    const B = attribute("aBase", "vec4") as any;
    const A = attribute("aAxis", "vec4") as any;
    const F = attribute("aFlow", "vec4") as any;
    const O = attribute("aOut", "vec4") as any;
    const u = positionGeometry.x as any;
    const w = positionGeometry.y as any;
    const L = B.w as any;
    const axis = normalize(A.xyz.add(vec3(0, 1e-4, 0))) as any;
    const outward = normalize(O.xyz) as any;
    const start = normalize(axis.mul(0.55).add(outward.mul(0.85))) as any;
    const carried = normalize(axis.mul(0.45).add(outward.mul(0.3)).add(F.xyz.mul(2.2)).add(vec3(0, 0.12, 0))) as any;
    const phase = A.w as any;
    const P1 = start.mul(L.mul(0.35)) as any;
    const P2 = carried.mul(L) as any;
    const one = u.oneMinus() as any;
    let centre: any = P1.mul(one.mul(u).mul(2)).add(P2.mul(u.mul(u)));
    const T = normalize(P1.mul(one.mul(2)).add(P2.sub(P1).mul(u.mul(2)))) as any;
    const flat = normalize(cross(axis, outward).add(vec3(1e-4, 0, 0))) as any;
    let N: any = normalize(cross(T, flat));
    // A slow twist down the blade and a flutter that runs from base to tip.
    const twist = sin(u.mul(2.6).add(phase)).mul(0.7) as any;
    let across: any = normalize(cross(N, T));
    const turned = across.mul(cos(twist)).add(N.mul(sin(twist))) as any;
    N = N.mul(cos(twist)).sub(across.mul(sin(twist)));
    across = turned;
    const flutter = sin(sea.clock.mul(1.7).add(phase).sub(u.mul(6))).mul(L.mul(0.04)).mul(u) as any;
    centre = centre.add(N.mul(flutter));
    // Lance-shaped, on a short stalk.
    const W = F.w.mul(smoothstep(0, 0.09, u)).mul(max(sin(u.mul(0.92).add(0.06).mul(Math.PI)), 0).pow(0.7)) as any;
    // Ruffled edges, and pocks in rows across the face.
    const freq = L.mul(38) as any;
    const ruffle = W.mul(0.42).mul(w.mul(w)).mul(sin(u.mul(freq).add(phase.mul(3)))) as any;
    const pock = W.mul(0.05).mul(sin(u.mul(freq.mul(2.7))).mul(cos(w.mul(9)))) as any;
    const bulge = ruffle.add(pock) as any;
    const placed = B.xyz.add(centre).add(across.mul(w.mul(W))).add(N.mul(bulge)) as any;
    // Never up through the surface: the canopy lies flat along it.
    const position = vec3(placed.x, placed.y.min(SURFACE - 0.015), placed.z);
    // The slope of the ruffle tips the normal.
    const dW = W.mul(0.84).mul(w).mul(sin(u.mul(freq).add(phase.mul(3)))).add(W.mul(-0.45).mul(sin(u.mul(freq.mul(2.7))).mul(sin(w.mul(9))))) as any;
    const dU = W.mul(0.42).mul(w.mul(w)).mul(freq).mul(cos(u.mul(freq).add(phase.mul(3)))) as any;
    const normal = normalize(N.sub(across.mul(dW.div(max(W, 0.004)))).sub(T.mul(dU.div(max(L, 0.1))).mul(0.3)));
    return { position, normal, across };
  };
  const bladeMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0, side: THREE.DoubleSide });
  const blade = bladeAt();
  bladeMaterial.positionNode = blade.position;
  const leafUv = varying(positionGeometry.xy) as any;
  // Close up, the blade's veins: fine ridges running from the stalk to the tip, drawing together toward each end, with a
  // crinkle across them. They tip the normal and darken a little, so they show in light coming through the blade.
  // Only within a couple of metres, where they are wider than a pixel.
  const bladeAcross = varying(blade.across) as any;
  const close = smoothstep(2.6, 0.9, positionWorld.sub(cameraPosition).length()) as any;
  const veinPhase = leafUv.y.mul(float(30).sub(leafUv.x.mul(8))).add(sin(leafUv.x.mul(9)).mul(0.5)) as any;
  const vein = smoothstep(0.55, 0.95, cos(veinPhase)) as any;
  const crinkle = sin(leafUv.x.mul(170).add(leafUv.y.mul(6))).mul(0.5) as any;
  const bladeNormal = normalize(varying(blade.normal).sub(bladeAcross.mul(sin(veinPhase).mul(0.28).mul(close))).add(bladeAcross.mul(crinkle.mul(0.08).mul(close)))) as any;
  bladeMaterial.normalNode = transformNormalToView(bladeNormal) as any;
  const tone = Fn_tone(leafUv, colours.blade).mul(float(1).sub(vein.mul(close).mul(0.16))) as any;
  bladeMaterial.colorNode = tone;
  underSea(bladeMaterial, tone, { normal: bladeNormal, through: tone.mul(vec3(1.25, 1.05, 0.55)).mul(0.9), caustics: "vertex" });

  // The floats: small glossy bladders where each blade meets the stipe.
  const floatMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0 });
  const floatAt = () => {
    const B = attribute("aBase", "vec4") as any;
    const A = attribute("aAxis", "vec4") as any;
    const O = attribute("aOut", "vec4") as any;
    const axis = normalize(A.xyz.add(vec3(0, 1e-4, 0))) as any;
    const along = normalize(axis.mul(0.55).add(normalize(O.xyz).mul(0.85))) as any;
    const flat = normalize(cross(axis, O.xyz).add(vec3(1e-4, 0, 0))) as any;
    const third = cross(along, flat) as any;
    const s = B.w.mul(0.05).add(0.012) as any;
    const p = positionGeometry as any;
    return { position: B.xyz.add(along.mul(p.y.mul(s.mul(1.5)).add(s))).add(flat.mul(p.x.mul(s))).add(third.mul(p.z.mul(s))), normal: normalize(along.mul(p.y).add(flat.mul(p.x)).add(third.mul(p.z))) };
  };
  const bladder = floatAt();
  floatMaterial.positionNode = bladder.position;
  const floatNormal = varying(bladder.normal) as any;
  floatMaterial.normalNode = transformNormalToView(floatNormal) as any;
  const floatColour = (colours.blade as any).mul(vec3(1.15, 1.05, 0.7)) as any;
  floatMaterial.colorNode = floatColour;
  underSea(floatMaterial, floatColour, { normal: floatNormal, through: floatColour.mul(0.6), caustics: "vertex" });

  const rootMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
  // Older haptera darker, younger ones paler, mottled over a few centimetres.
  const rootColour = (colours.stipe as any).mul(mx_noise_float(positionWorld.mul(28)).mul(0.25).add(0.85)).mul(vec3(1, 0.97, 0.9)) as any;
  rootMaterial.colorNode = rootColour;
  underSea(rootMaterial, rootColour, { caustics: "vertex" });
  return { stipe: stipeMaterial, blade: bladeMaterial, float: floatMaterial, root: rootMaterial };
}

function meshesOf(built: Built, looks: ReturnType<typeof materials>) {
  const stipes = new THREE.Mesh(built.tube, looks.stipe);
  const blades = new THREE.Mesh(built.leaf, looks.blade);
  const floats = new THREE.Mesh(built.float, looks.float);
  const roots = new THREE.Mesh(built.roots, looks.root);
  for (const m of [stipes, blades, floats]) m.frustumCulled = false;
  return { stipes, blades, floats, roots };
}

// A tube along a curve, its radius running from r0 at the start to r1 at the end, with a rounded cap at the far end.
function taperedTube(curve: THREE.Curve<THREE.Vector3>, segments: number, r0: number, r1: number, radial: number) {
  const frames = curve.computeFrenetFrames(segments, false);
  const points: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      points.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// The blade's own colour: darker toward the stalk and down the middle, finely streaked along its length, paler and
// thinner at the ruffled edges, with a little blotching.
function Fn_tone(uv: any, base: any): any {
  const u = uv.x as any;
  const w = uv.y as any;
  const streak = sin(w.mul(37).add(sin(u.mul(11)).mul(2))).mul(0.06).add(0.97) as any;
  const blotch = sin(u.mul(23).add(w.mul(3))).mul(sin(u.mul(7.3))).mul(0.08).add(1) as any;
  const middle = float(1).sub(abs(w).oneMinus().pow(6).mul(0.18)) as any;
  const edge = smoothstep(0.7, 1, abs(w)).mul(0.25).add(1) as any;
  const toTip = mix(float(0.6), float(1.12), smoothstep(0, 0.5, u)) as any;
  return base.mul(streak).mul(blotch).mul(middle).mul(edge).mul(toTip).mul(color("#ffffff"));
}

const tangent = new THREE.Vector3();
const outward = new THREE.Vector3();

// Plain loops with nothing made along the way: this runs for every length of stipe and every blade, every frame.
function fill(forest: Forest, built: Built) {
  const p = forest.chains.shown;
  const rel = forest.chains.stream;
  const e0 = built.ends[0].array as Float32Array;
  const e1 = built.ends[1].array as Float32Array;
  const e2 = built.ends[2].array as Float32Array;
  const e3 = built.ends[3].array as Float32Array;
  const last = NODES - 1;
  let o = 0;
  for (const i of built.stipes) {
    const first = i * NODES;
    const thick = forest.stipes[i].thick;
    for (let k = 0; k < last; k++) {
      const q0 = (first + Math.max(0, k - 1)) * 3;
      const q1 = (first + k) * 3;
      const q2 = (first + k + 1) * 3;
      const q3 = (first + Math.min(last, k + 2)) * 3;
      e0[o] = p[q0];
      e0[o + 1] = p[q0 + 1];
      e0[o + 2] = p[q0 + 2];
      e1[o] = p[q1];
      e1[o + 1] = p[q1 + 1];
      e1[o + 2] = p[q1 + 2];
      e2[o] = p[q2];
      e2[o + 1] = p[q2 + 1];
      e2[o + 2] = p[q2 + 2];
      e3[o] = p[q3];
      e3[o + 1] = p[q3 + 1];
      e3[o + 2] = p[q3 + 2];
      // Radius in the fourth place of the two middle points: thicker at the root, thinner up the stipe.
      e1[o + 3] = (0.016 - 0.007 * Math.min(1, k / 6)) * thick;
      e2[o + 3] = (0.016 - 0.007 * Math.min(1, (k + 1) / 6)) * thick;
      o += 4;
    }
  }
  for (const a of built.ends) a.needsUpdate = true;

  const b = built.base.array as Float32Array;
  const a = built.axis.array as Float32Array;
  const f = built.stream.array as Float32Array;
  const out = built.out.array as Float32Array;
  const sites = built.sites;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const first = site.stipe * NODES;
    const q = (first + site.node) * 3;
    const before = (first + site.node - 1) * 3;
    const after = (first + Math.min(last, site.node + 1)) * 3;
    tangent.set(p[after] - p[before], p[after + 1] - p[before + 1], p[after + 2] - p[before + 2]).normalize();
    // Out to one side of the stipe, the site's own level direction squared to it. A little of the level way across the
    // stipe is added so it never runs out when the stipe lies along that direction: the side then turns smoothly
    // instead of flipping, as it did when it switched from one reference to another, which made the blades twitch.
    const tx = tangent.x;
    const ty = tangent.y;
    const tz = tangent.z;
    const d = site.cx * tx + site.cz * tz;
    outward.set(site.cx - tx * d - 0.3 * tz, -ty * d, site.cz - tz * d + 0.3 * tx).normalize();
    const j = i * 4;
    b[j] = p[q];
    b[j + 1] = p[q + 1];
    b[j + 2] = p[q + 2];
    a[j] = tangent.x;
    a[j + 1] = tangent.y;
    a[j + 2] = tangent.z;
    f[j] = rel[q];
    f[j + 1] = rel[q + 1];
    f[j + 2] = rel[q + 2];
    out[j] = outward.x;
    out[j + 1] = outward.y;
    out[j + 2] = outward.z;
  }
  built.base.needsUpdate = true;
  built.axis.needsUpdate = true;
  built.stream.needsUpdate = true;
  built.out.needsUpdate = true;
}
