
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { color, float, mix, mx_noise_float, normalView, normalize, positionLocal, smoothstep, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { useDispose } from "./engine/dispose";
import { lehmer } from "./engine/random";
import { CLEARINGS, floorAt } from "./kelp";
import { underSea } from "./shade";
import { stirs } from "./stir";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Pacific rock crabs, built and moved like the real animal. A broad oval shell, wider than long, its front edges cut into
// teeth, brick red above and pale yellow spotted red beneath; eyes on short stalks; a pair of heavy claws with black-tipped
// fingers held folded before the mouth; and four walking legs a side, each of the crab's own segments in their order out
// from the body (the short basis-ischium, the long flat merus, carpus, propodus, and the pointed dactyl it stands on
// tiptoe on), every joint a hinge. A leg is solved each frame in the plane through its hip, its foot and the body's up:
// the merus rises from the body to a knee about level with the top of the shell, carpus and propodus come down, and the
// dactyl stabs steeply into the sand. Lengths never change.
//
// A crab walks sideways, in an alternating tetrapod: the first and third legs of one side with the second and fourth of
// the other, the two sets taking turns, each foot lifted and set down ahead of where the body is going. It walks a little,
// stops, picks at the sand with its claws, and walks on; anything bursting near it sends it scuttling off.

// Walking legs, front to back: where each joins the body (along the body, as a fraction of the shell's width), which way
// its foot rests from straight ahead, and how long it is against the shell's width.
const LEGS = [
  { hip: 0.16, aim: 42, length: 0.84 },
  { hip: 0.05, aim: 74, length: 0.96 },
  { hip: -0.06, aim: 104, length: 0.92 },
  { hip: -0.16, aim: 134, length: 0.8 }
];
// The segments of a walking leg, as fractions of its length: basis-ischium, merus, carpus, propodus, dactyl.
const SEG = [0.13, 0.36, 0.17, 0.2, 0.14];
// How far out a foot rests, as a fraction of its leg.
const SPAN = 0.74;
// Where they keep: a sandy clearing out ahead of the eye's start, where the start view first meets the ground (the
// grass and low kelp leave it bare, so they are seen).

type Leg = { side: number; n: number; set: number; foot: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; swing: number; swingFor: number; cycle: number };
type Crab = {
  // The clearing it keeps to.
  home: THREE.Vector2;
  roam: number;
  width: number;
  at: THREE.Vector3;
  heading: number;
  turn: number;
  speed: number;
  want: number;
  dir: number;
  walking: boolean;
  timer: number;
  phase: number;
  legs: Leg[];
  pick: number;
  picking: number;
  settle: number;
  random: () => number;
};

// A sphere pulled into a shape by a function of its unit position.
function shaped(shape: (p: THREE.Vector3) => void, wide: number, high: number) {
  const g = new THREE.SphereGeometry(1, wide, high);
  const p = g.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    shape(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

// The shell, one unit wide: an oval wider than long, domed above and flatter beneath, narrowing behind, its front edges
// cut into nine teeth a side and a notch between the eyes.
function shell() {
  return shaped(
    (v) => {
      const a = Math.atan2(v.z, Math.abs(v.x));
      const rim = Math.pow(1 - Math.abs(v.y), 2);
      // Along the front edges only, from beside the eyes round to the widest point (three's smoothstep needs its edges in order).
      const front = THREE.MathUtils.smoothstep(a, 0.15, 0.5) * (1 - THREE.MathUtils.smoothstep(a, 1.2, 1.45));
      const tooth = Math.pow(Math.abs(Math.sin(a * 13)), 6) * 0.08 * front * rim;
      const back = v.z < 0 ? 1 - 0.22 * -v.z : 1;
      const notch = v.z > 0 && Math.abs(v.x) < 0.14 ? 0.03 * (1 - Math.abs(v.x) / 0.14) * rim : 0;
      const x = v.x * 0.5 * back * (1 + tooth);
      const z = v.z * 0.33 * (1 + tooth) - notch;
      // Flat-topped with a sharp edge: the height rises fast from the rim and then levels. On top, lumps over the regions
      // of the gut and heart, and the shallow grooves that part them.
      let y = v.y > 0 ? Math.pow(v.y, 0.65) * 0.15 * (1 - 0.15 * v.z * v.z) : -Math.pow(-v.y, 0.8) * 0.075;
      if (v.y > 0) {
        const groove = Math.exp(-((Math.abs(x) - 0.11) ** 2) / 0.0012) * THREE.MathUtils.smoothstep(z, -0.25, 0.05) * 0.012;
        const lumps = (Math.sin(x * 31 + 1.3) * Math.sin(z * 37) * 0.5 + 0.5) * 0.008;
        // Granules: small raised tubercles all over the top, larger toward the front.
        const granules = Math.max(0, Math.sin(x * 95 + Math.sin(z * 23) * 2) * Math.sin(z * 101 + Math.sin(x * 19) * 2)) ** 2 * (0.0035 + 0.002 * Math.max(0, z / 0.33));
        y += (lumps - groove) * Math.pow(v.y, 0.5) + granules * Math.min(1, v.y * 4);
      }
      v.set(x, y, z);
    },
    200,
    90
  );
}

export function Crabs({ active }: { active: boolean }) {
  const count = CLEARINGS.reduce((n, c) => n + c.crabs, 0);
  const parts = useMemo(() => {
    // Shell: brick red to red-brown above, mottled and finely granular; pale yellow beneath with red spots.
    const p = positionLocal as any;
    // Every surface finely granular: the normal tipped about by small-scale noise.
    const grainy = (scale: number, amount: number) => normalize(normalView.add(vec3(mx_noise_float(p.mul(scale)), mx_noise_float(p.mul(scale).add(7.1)), mx_noise_float(p.mul(scale).add(13.7))).mul(amount))) as any;
    // Wet chitin: a clear coat of water over a rougher shell.
    const shellMaterial = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.6, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.35 });
    shellMaterial.normalNode = grainy(90, 0.22);
    const mottle = mx_noise_float(p.mul(9)).mul(0.5).add(0.5) as any;
    const granule = smoothstep(0.45, 0.75, mx_noise_float(p.mul(70))).mul(0.2) as any;
    const patches = smoothstep(0.2, 0.6, mx_noise_float(p.mul(4).add(2))).mul(0.35) as any;
    const top = mix(mix(color("#4a1a12"), color("#7a3220"), mottle), color("#3a1a1e"), patches).mul(float(1).sub(granule)) as any;
    const spots = smoothstep(0.5, 0.65, mx_noise_float(p.mul(22).add(3))) as any;
    const under = mix(color("#e2cf9c"), color("#b24434"), spots.mul(0.8)) as any;
    const edge = smoothstep(-0.02, 0.03, p.y) as any;
    // A paler band along the rim and its teeth.
    const rimBand = smoothstep(0.045, 0.01, p.y).mul(edge).mul(0.5) as any;
    const shellTone = mix(under, mix(top, color("#b06a40"), rimBand), edge) as any;
    shellMaterial.colorNode = shellTone;
    underSea(shellMaterial, shellTone, { caustics: "vertex" });

    // Legs: red-brown, paler beneath and at the joints, along each segment (y runs 0 to 1 along it).
    const limbMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
    limbMaterial.normalNode = grainy(160, 0.18);
    const along = p.y as any;
    const joint = smoothstep(0.18, 0, along).add(smoothstep(0.82, 1, along)).min(1) as any;
    const limbTone = mix(mix(color("#521c12"), color("#7e3420"), mx_noise_float(p.mul(vec3(6, 2, 6))).mul(0.5).add(0.5)), color("#c8a088"), joint.mul(0.4)) as any;
    limbMaterial.colorNode = limbTone;
    underSea(limbMaterial, limbTone, { caustics: "vertex" });

    // Dactyls and the claws' fingers: the leg's colour, going black toward the point.
    const tipMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0 });
    const tipTone = mix(color("#5a2216"), color("#120a08"), smoothstep(0.3, 0.65, along)) as any;
    tipMaterial.colorNode = tipTone;
    underSea(tipMaterial, tipTone, { caustics: "vertex" });

    // Claws' palms: swollen, red-brown above, paler below.
    const palmMaterial = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.55, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.35 });
    palmMaterial.normalNode = grainy(70, 0.2);
    const palmTone = mix(color("#d2b08a"), mix(color("#4e1c12"), color("#7a3220"), mx_noise_float(p.mul(8)).mul(0.5).add(0.5)), smoothstep(-0.5, 0.1, p.z)) as any;
    palmMaterial.colorNode = palmTone;
    underSea(palmMaterial, palmTone, { caustics: "vertex" });

    // Eyes: dark and glossy.
    const eyeMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0 });
    eyeMaterial.colorNode = color("#0c0a08");
    underSea(eyeMaterial, color("#0c0a08") as any, { caustics: false });

    // A soft shadow on the sand beneath each, so it sits on the floor.
    const shadowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    shadowMaterial.colorNode = color("#000000");

    const tube = new THREE.CylinderGeometry(0.82, 1, 1, 10, 1).translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
    const knob = new THREE.SphereGeometry(1, 10, 8);
    const ball = new THREE.SphereGeometry(1, 16, 12);
    const disc = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const back = shell();
    // Per crab: four bones a walking leg, two a claw arm, one an eyestalk.
    const bones = new THREE.InstancedMesh(tube, limbMaterial, count * (8 * 4 + 2 * 2 + 2));
    const knobs = new THREE.InstancedMesh(knob, limbMaterial, count * (8 * 5 + 2 * 3));
    const tips = new THREE.InstancedMesh(cone, tipMaterial, count * (8 + 4));
    const palms = new THREE.InstancedMesh(ball, palmMaterial, count * 2);
    const eyes = new THREE.InstancedMesh(knob, eyeMaterial, count * 2);
    const shells = new THREE.InstancedMesh(back, shellMaterial, count);
    const shadows = new THREE.InstancedMesh(disc, shadowMaterial, count);
    // Shadow treats the disc's own x and z as its round.
    shadowMaterial.opacityNode = smoothstep(1, 0.2, vec2(p.x, p.z).length()).mul(0.42) as any;
    shadows.renderOrder = 1;
    const meshes = [shadows, shells, bones, knobs, tips, palms, eyes];
    // Rewritten whole every frame and sent once: left at the usual usage, as three's WebGPU backend sends an attribute
    // marked dynamic again for every pass it is drawn in, whether or not it has changed since.
    for (const m of meshes) m.frustumCulled = false;
    return { meshes, bones, knobs, tips, palms, eyes, shells, shadows, geometries: [tube, cone, knob, ball, disc, back], materials: [shellMaterial, limbMaterial, tipMaterial, palmMaterial, eyeMaterial, shadowMaterial] };
  }, [count]);
  useDispose(...parts.geometries, ...parts.materials);

  const crabs = useMemo(() => {
    const random = lehmer(7717);
    return Array.from({ length: count }, (_, i): Crab => {
      const a = (i / count) * Math.PI * 2 + random();
      const clearing = CLEARINGS.find((_, n) => i < CLEARINGS.slice(0, n + 1).reduce((t, c) => t + c.crabs, 0))!;
      const centre = new THREE.Vector2(clearing.x, clearing.z);
      const r = clearing.r * (0.3 + random() * 0.6);
      const at = new THREE.Vector3(centre.x + Math.cos(a) * r, 0, centre.y + Math.sin(a) * r);
      const width = 0.24 + random() * 0.06;
      // Facing the eye's start, more or less.
      const heading = Math.atan2(0.9 - at.x, 7.6 - at.z) + (random() - 0.5) * 1.2;
      const crab: Crab = { home: centre, roam: clearing.r, width, at, heading, turn: 0, speed: 0, want: 0, dir: 1, walking: false, timer: 1 + random() * 3, phase: random(), legs: [], pick: 0, picking: 0, settle: 0, random: lehmer(900 + i * 31) };
      for (const side of [-1, 1])
        LEGS.forEach((_, n) => {
          const set = (n % 2 === 0) === (side < 0) ? 0 : 1;
          const foot = home(crab, side, n, new THREE.Vector3());
          crab.legs.push({ side, n, set, foot, from: foot.clone(), to: foot.clone(), swing: -1, swingFor: 0.2, cycle: -1 });
        });
      return crab;
    });
  }, [count]);

  // For testing in development: find them from the console.
  if (import.meta.env.DEV) Object.assign(globalThis, { __crabs: crabs });

  useFrame((_, raw) => {
    if (!active) return;
    const delta = Math.min(raw, 1 / 20);
    let b = 0;
    let k = 0;
    let t = 0;
    let pl = 0;
    let e = 0;
    for (const crab of crabs) behave(crab, delta);
    keepApart(crabs);
    crabs.forEach((crab, c) => {
      const W = crab.width;
      // The body: over the ground, tipped to its slope, bobbing a little with each step.
      const pose = frame(crab);
      parts.shells.setMatrixAt(c, m.compose(pose.centre, pose.q, s3.set(W, W, W)));
      parts.shadows.setMatrixAt(c, m.compose(v1.set(crab.at.x, floorAt(crab.at.x, crab.at.z) + 0.004, crab.at.z), pose.q, s3.set(W * 0.75, 1, W * 0.6)));

      const bone = (a: THREE.Vector3, z: THREE.Vector3, r: number, flat: number, knobbed: boolean) => {
        parts.bones.setMatrixAt(b++, oriented(a, z, r, flat, pose.up));
        if (knobbed) parts.knobs.setMatrixAt(k++, m.compose(a, q0, s3.setScalar(r * 0.72)));
      };
      const tip = (a: THREE.Vector3, z: THREE.Vector3, r: number) => parts.tips.setMatrixAt(t++, oriented(a, z, r, 0.8, pose.up));

      // Walking legs.
      for (const leg of crab.legs) {
        const spec = LEGS[leg.n];
        const L = spec.length * W;
        const hip = local(pose, leg.side * 0.27 * W, -0.05 * W, spec.hip * W, v1);
        const j = solve(hip, leg.foot, pose.up, L);
        const r = W * 0.05 * (leg.n === 1 || leg.n === 2 ? 1.05 : 0.95);
        bone(j[0], j[1], r * 1.1, 0.8, true);
        bone(j[1], j[2], r * 1.2, 0.55, true);
        bone(j[2], j[3], r * 0.9, 0.75, true);
        bone(j[3], j[4], r * 0.8, 0.7, true);
        parts.knobs.setMatrixAt(k++, m.compose(j[4], q0, s3.setScalar(r * 0.55)));
        tip(j[4], j[5], r * 0.62);
      }

      // Claws: arm out and forward from the front of the body, the wrist folding in, the palm held across before the mouth,
      // the fixed finger beneath and the moving one above. Picking at the sand, they reach down and forward, the fingers
      // part and close, and they come back up to the mouth.
      const pick = crab.pick;
      const open = Math.sin(Math.min(1, pick * 1.6) * Math.PI) * 0.6;
      for (const side of [-1, 1]) {
        const s = side;
        const lift = s > 0 ? pick : Math.max(0, pick - 0.25) / 0.75;
        const c0 = local(pose, s * 0.24 * W, -0.04 * W, 0.18 * W, v1).clone();
        const c1 = local(pose, s * 0.4 * W, 0.0 * W, 0.34 * W, v2).clone();
        const c2 = local(pose, s * 0.31 * W, (0.03 - 0.16 * lift) * W, (0.48 + 0.08 * lift) * W, v3).clone();
        const c3 = local(pose, s * 0.08 * W, (0.02 - 0.2 * lift) * W, (0.58 + 0.12 * lift) * W, v4).clone();
        bone(c0, c1, W * 0.07, 0.7, true);
        bone(c1, c2, W * 0.075, 0.75, true);
        parts.knobs.setMatrixAt(k++, m.compose(c2, q0, s3.setScalar(W * 0.05)));
        // The palm: swollen, longer than it is tall and taller than it is thick, held upright across the front.
        d1.subVectors(c3, c2);
        const palmLength = d1.length();
        d1.normalize();
        ox.crossVectors(d1, pose.up).normalize();
        oz.crossVectors(ox, d1).normalize();
        orient.makeBasis(ox.multiplyScalar(W * 0.065), oy.copy(d1).multiplyScalar(palmLength * 0.62), oz.multiplyScalar(W * 0.1));
        orient.setPosition(v5.lerpVectors(c2, c3, 0.5));
        parts.palms.setMatrixAt(pl++, orient);
        // Fingers: on toward the middle and a little forward, the moving one opening upward.
        d2.copy(d1).addScaledVector(pose.forward, 0.35).normalize();
        const fingerLength = W * 0.2;
        tip(v5.copy(c3).addScaledVector(d1, -W * 0.03).addScaledVector(pose.up, -W * 0.035), v6.copy(c3).addScaledVector(d2, fingerLength).addScaledVector(pose.up, -W * 0.05), W * 0.034);
        tip(v5.copy(c3).addScaledVector(d1, -W * 0.03).addScaledVector(pose.up, W * 0.03), v6.copy(c3).addScaledVector(d2, fingerLength * 0.95).addScaledVector(pose.up, W * (-0.005 + open * 0.12)), W * 0.03);
      }

      // Eyes on short stalks either side of the notch, twitching now and then.
      for (const side of [-1, 1]) {
        const twitch = Math.sin(crab.phase * 9 + side) * 0.008 * W;
        const base = local(pose, side * 0.07 * W, 0.08 * W, 0.28 * W, v1).clone();
        const top = local(pose, side * (0.1 * W + twitch), 0.15 * W, 0.31 * W, v2);
        bone(base, top, W * 0.018, 1, false);
        parts.eyes.setMatrixAt(e++, m.compose(top, q0, s3.setScalar(W * 0.02)));
      }
    });
    for (const mesh of parts.meshes) mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {parts.meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </>
  );
}

const m = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const s3 = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const v5 = new THREE.Vector3();
const v6 = new THREE.Vector3();
const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();

type Pose = { centre: THREE.Vector3; q: THREE.Quaternion; up: THREE.Vector3; side: THREE.Vector3; forward: THREE.Vector3 };
const pose: Pose = { centre: new THREE.Vector3(), q: new THREE.Quaternion(), up: new THREE.Vector3(), side: new THREE.Vector3(), forward: new THREE.Vector3() };
const basis = new THREE.Matrix4();

// The body's frame: x out to the right, y up, z forward to the eyes. Tipped to the slope of the floor under it, at a
// height that clears the sand, bobbing a little with the step.
function frame(crab: Crab): Pose {
  const { at, width: W } = crab;
  const h = floorAt(at.x, at.z);
  at.y = h;
  const e = 0.05;
  const nx = -(floorAt(at.x + e, at.z) - floorAt(at.x - e, at.z)) / (2 * e);
  const nz = -(floorAt(at.x, at.z + e) - floorAt(at.x, at.z - e)) / (2 * e);
  pose.up.set(nx * 0.7, 1, nz * 0.7).normalize();
  pose.forward.set(Math.sin(crab.heading), 0, Math.cos(crab.heading));
  pose.side.crossVectors(pose.up, pose.forward).normalize();
  pose.forward.crossVectors(pose.side, pose.up).normalize();
  basis.makeBasis(pose.side, pose.up, pose.forward);
  pose.q.setFromRotationMatrix(basis);
  const bob = crab.walking ? Math.abs(Math.sin(crab.phase * Math.PI * 2)) * 0.012 * W : 0;
  pose.centre.copy(at).setY(h + 0.24 * W + bob);
  return pose;
}

// A point given in the body's frame, in the world.
function local(p: Pose, x: number, y: number, z: number, out: THREE.Vector3) {
  return out.copy(p.centre).addScaledVector(p.side, x).addScaledVector(p.up, y).addScaledVector(p.forward, z);
}

// Where a leg's foot rests, under a body in its frame now.
function home(crab: Crab, side: number, n: number, out: THREE.Vector3) {
  const p = frame(crab);
  const spec = LEGS[n];
  const W = crab.width;
  const a = (spec.aim * Math.PI) / 180;
  const reach = spec.length * W * SPAN + 0.27 * W;
  local(p, side * Math.sin(a) * reach, 0, spec.hip * W + Math.cos(a) * reach, out);
  out.y = floorAt(out.x, out.z) + 0.002;
  return out;
}

const joints = Array.from({ length: 6 }, () => new THREE.Vector3());
const across = new THREE.Vector3();

// A walking leg's joints, hip to foot, in the plane through them and the body's up: the basis-ischium out and a little
// down, the merus up to a high knee, carpus and propodus down (bent a little between them), the dactyl steeply to the
// foot. A foot out of reach straightens the leg toward it rather than stretching it.
function solve(hip: THREE.Vector3, foot: THREE.Vector3, up: THREE.Vector3, length: number) {
  const L = SEG.map((f) => f * length);
  across.subVectors(foot, hip);
  const rise = across.dot(up);
  across.addScaledVector(up, -rise);
  const out = Math.max(1e-6, across.length());
  across.divideScalar(out);
  const at = (x: number, y: number, v: THREE.Vector3) => v.copy(hip).addScaledVector(across, x).addScaledVector(up, y);
  const cx = L[0] * 0.95;
  const cy = -L[0] * 0.2;
  const slant = 1.2;
  const lower = L[4];
  let ax = out - Math.cos(slant) * lower;
  let ay = rise + Math.sin(slant) * lower;
  const upper = L[1];
  const middle = L[2] + L[3];
  let dx = ax - cx;
  let dy = ay - cy;
  let span = Math.hypot(dx, dy);
  const most = (upper + middle) * 0.995;
  const least = Math.abs(upper - middle) * 1.05;
  if (span > most || span < least) {
    const to = span > most ? most : least;
    ax = cx + (dx / Math.max(span, 1e-9)) * to;
    ay = cy + (dy / Math.max(span, 1e-9)) * to;
    dx = ax - cx;
    dy = ay - cy;
    span = to;
  }
  const along = (span * span + upper * upper - middle * middle) / (2 * span);
  const h = Math.sqrt(Math.max(0, upper * upper - along * along));
  const kx = cx + (dx * along) / span - (dy * h) / span;
  const ky = cy + (dy * along) / span + (dx * h) / span;
  const pc = L[2] / middle;
  at(0, 0, joints[0]);
  at(cx, cy, joints[1]);
  at(kx, ky, joints[2]);
  at(kx + (ax - kx) * pc, ky + (ay - ky) * pc + L[2] * 0.18, joints[3]);
  at(ax, ay, joints[4]);
  at(ax + Math.cos(slant) * lower, ay - Math.sin(slant) * lower, joints[5]);
  return joints;
}

const ox = new THREE.Vector3();
const oy = new THREE.Vector3();
const oz = new THREE.Vector3();
const orient = new THREE.Matrix4();

// A segment from a to z of radius r, flattened across by flat in the plane of the leg (crab legs are flat-sided).
function oriented(a: THREE.Vector3, z: THREE.Vector3, r: number, flat: number, up: THREE.Vector3) {
  oy.subVectors(z, a);
  const length = oy.length();
  oy.divideScalar(Math.max(length, 1e-9));
  ox.crossVectors(oy, up);
  if (ox.lengthSq() < 1e-8) ox.set(1, 0, 0);
  ox.normalize();
  oz.crossVectors(ox, oy).normalize();
  orient.makeBasis(ox.multiplyScalar(r * flat), oy.multiplyScalar(length), oz.multiplyScalar(r));
  orient.setPosition(a);
  return orient;
}

const toward = new THREE.Vector3();
const ahead = new THREE.Vector3();

// Walking a little and stopping, picking at the sand while still; scuttling off from anything that bursts near; and the
// legs stepping in their two alternating sets as the body goes.
function behave(crab: Crab, delta: number) {
  const random = crab.random;
  crab.timer -= delta;
  // Startled by a burst in the water close by: off sideways, fast, away from it.
  for (const st of stirs) {
    if (st.burst <= 0 || st.age > 0.3) continue;
    const d = Math.hypot(st.at.x - crab.at.x, st.at.z - crab.at.z);
    if (d < 1.4 && !(crab.walking && crab.want > 0.2)) {
      const side = Math.cos(crab.heading) * (crab.at.x - st.at.x) - Math.sin(crab.heading) * (crab.at.z - st.at.z);
      crab.dir = side >= 0 ? 1 : -1;
      crab.walking = true;
      crab.want = 0.32;
      crab.timer = 1.2 + random();
    }
  }
  if (crab.timer <= 0) {
    if (crab.walking) {
      crab.walking = false;
      crab.want = 0;
      crab.timer = 1.5 + random() * 4;
      crab.picking = random() < 0.7 ? 1 : 0;
    } else {
      crab.walking = true;
      crab.timer = 1.2 + random() * 2.6;
      crab.want = 0.05 + random() * 0.06;
      crab.turn = (random() - 0.5) * 0.5;
      // Sideways, either way, but back toward its patch of floor if it has strayed.
      toward.set(crab.home.x - crab.at.x, 0, crab.home.y - crab.at.z);
      const sideways = Math.cos(crab.heading) * toward.x - Math.sin(crab.heading) * toward.z;
      crab.dir = toward.length() > crab.roam ? Math.sign(sideways) || 1 : random() < 0.5 ? -1 : 1;
    }
  }
  crab.speed += (crab.want - crab.speed) * (1 - Math.exp(-delta * 4));
  const W = crab.width;
  if (crab.walking || crab.speed > 0.005) {
    crab.heading += crab.turn * delta * (crab.speed / 0.08);
    const sx = Math.cos(crab.heading);
    const sz = -Math.sin(crab.heading);
    crab.at.x += sx * crab.dir * crab.speed * delta;
    crab.at.z += sz * crab.dir * crab.speed * delta;
  }
  // The claws: down to the sand and back to the mouth, every second or so while it is still.
  if (!crab.walking && crab.picking) crab.pick = 0.5 - 0.5 * Math.cos(((performance.now() / 1000) * 1.3 + W * 40) % (Math.PI * 2));
  else crab.pick *= Math.exp(-delta * 6);

  // The stride: how far a foot travels in one step, and how often the two sets swap.
  const stride = W * 0.42;
  const speed = Math.max(crab.speed, 1e-4);
  if (crab.walking || crab.speed > 0.01) crab.phase += (speed / stride) * delta;
  const period = stride / speed;
  const swingFor = Math.min(0.35, period * 0.45);
  const sx = Math.cos(crab.heading) * crab.dir * crab.speed;
  const sz = -Math.sin(crab.heading) * crab.dir * crab.speed;
  crab.settle -= delta;
  for (const leg of crab.legs) {
    if (leg.swing >= 0) {
      leg.swing += delta / leg.swingFor;
      const s = Math.min(1, leg.swing);
      const ease = s * s * (3 - 2 * s);
      leg.foot.lerpVectors(leg.from, leg.to, ease);
      leg.foot.y = floorAt(leg.foot.x, leg.foot.z) + 0.002 + Math.sin(s * Math.PI) * W * 0.16;
      if (leg.swing >= 1) leg.swing = -1;
      continue;
    }
    home(crab, leg.side, leg.n, ahead);
    if (crab.speed > 0.01) {
      // Each set lifts in its half of the cycle, once a cycle, and is set down ahead of the body's way.
      const shifted = crab.phase + (leg.set ? 0.5 : 0);
      const cycle = Math.floor(shifted);
      if (shifted - cycle < 0.5 && cycle !== leg.cycle) {
        leg.cycle = cycle;
        const lead = period * 0.5 + swingFor;
        ahead.x += sx * lead * 0.5;
        ahead.z += sz * lead * 0.5;
        ahead.y = floorAt(ahead.x, ahead.z) + 0.002;
        start(leg, ahead, swingFor);
      }
    } else if (crab.settle <= 0 && leg.foot.distanceTo(ahead) > W * 0.06) {
      // Standing: feet left astray step back under the body, one at a time.
      start(leg, ahead, 0.22);
      crab.settle = 0.15;
    }
  }
}

// Crabs never walk into each other: two closer than their legs' reach are pushed apart, half each, and one walking
// toward the other turns about and goes back the way it came.
function keepApart(crabs: Crab[]) {
  for (let i = 0; i < crabs.length; i++)
    for (let j = i + 1; j < crabs.length; j++) {
      const a = crabs[i];
      const b = crabs[j];
      const dx = b.at.x - a.at.x;
      const dz = b.at.z - a.at.z;
      const d = Math.hypot(dx, dz) || 1e-6;
      const room = (a.width + b.width) * 1.05;
      if (d >= room * 1.4) continue;
      for (const [crab, sign] of [[a, 1], [b, -1]] as const) {
        // Heading for the other: its way is along its side axis, by dir.
        const vx = Math.cos(crab.heading) * crab.dir;
        const vz = -Math.sin(crab.heading) * crab.dir;
        if (crab.walking && (vx * dx + vz * dz) * sign > 0) {
          crab.dir = -crab.dir;
          crab.speed *= 0.3;
        }
      }
      if (d < room) {
        const push = (room - d) / 2 / d;
        a.at.x -= dx * push;
        a.at.z -= dz * push;
        b.at.x += dx * push;
        b.at.z += dz * push;
      }
    }
}

function start(leg: Leg, to: THREE.Vector3, swingFor: number) {
  leg.from.copy(leg.foot);
  leg.to.copy(to);
  leg.swing = 0;
  leg.swingFor = swingFor;
}
