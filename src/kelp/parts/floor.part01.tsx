
import { useMemo } from "react";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { abs, attribute, cameraPosition, color, cos, cross, dot, faceDirection, float, max, mix, mx_noise_float, normalize, normalViewGeometry, positionGeometry, positionView, positionWorld, sin, smoothstep, sqrt, texture, transformNormalToView, uniform, varying, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { useDispose } from "./engine/dispose";
import { lehmer } from "./engine/random";
import { floorAssets, type FloorAssets } from "./procedural";
import { floorAt, inClearing, type Plant } from "./kelp";
import { underSea } from "./shade";
import { SWELL, sea, swayAt } from "./water";

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

// The floor: scanned sand and pebbles pushed up by their own heights, rippled sand between, scanned rocks heaped into
// reef, hundreds of loose stones, and everything that lives on it. Every "scan" is procedurally generated
// (procedural.ts); the living things are built here, each from many small parts, and they bend with
// the swell.

// All of the floor's "scans" are generated now (see procedural.ts): sand, pebbled sand and rock textures, and ten kinds
// of sculpted rock, built from noise on the CPU the first time the floor is shown.
export type { FloorAssets } from "./procedural";
export const useFloorAssets = (fine: boolean) => floorAssets(fine);

// Where the rocks lie: heaped in outcrops, one close by the start, and loose ones scattered between.
export type Stone = { x: number; z: number; y: number; size: number; turn: number; kind: number };
export const ROCK_KINDS = 10;
// Where the eye starts, low in the grass: nothing grows right on it.
const EYE = [0.9, 7.6];

export function placeStones(seed: number, plants: Plant[], fine: number) {
  const random = lehmer(seed);
  const stones: Stone[] = [];
  const outcrops = [
    [-2.4, 2.8, 1.5],
    [3.4, -1.5, 1.8],
    [-6.5, -4.5, 2.6],
    [7, 3.5, 1.6],
    [-1, -8, 2.4],
    [10, -7, 2.8],
    [-11, 3, 2.6],
    [2, 10.5, 1.2],
    [-4.5, 7.5, 1.4],
    [5.5, 8, 1.5],
    [-9, -10, 2.4],
    [13, 2, 2.4],
    [0.5, -13, 2.6],
    [-14, -3, 2.6],
    [-3.2, -2, 1.1],
    [4.5, 3.5, 0.9],
    [-7.5, 1.5, 1.6],
    [8.5, -2.5, 1.8],
    [-1.5, 5.2, 0.9],
    [6.5, -9.5, 2.2],
    [-12, 7.5, 2.4],
    [11, 8.5, 2],
    [-5.5, -12.5, 2.4],
    [1.5, -4.8, 1.2],
    [-16, -9, 2.8],
    [16, -4, 2.6]
  ];
  for (const [ox, oz, spread] of outcrops) {
    const n = Math.round((4 + random() * 4) * (0.5 + fine * 0.5));
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * spread;
      const x = ox + Math.cos(a) * r;
      const z = oz + Math.sin(a) * r;
      if (Math.hypot(x - EYE[0], z - EYE[1]) < 1) continue;
      if (inClearing(x, z, 0.1)) continue;
      if (plants.some((p) => Math.hypot(p.x - x, p.z - z) < 0.45)) continue;
      const size = (0.35 + random() ** 1.5 * 1.7) * (1 - (r / spread) * 0.5);
      // The heaviest scan (the last) only for the big ones, where its detail shows.
      const kind = size > 1 ? Math.floor(random() * ROCK_KINDS) : Math.floor(random() * (ROCK_KINDS - 1));
      stones.push({ x, z, y: floorAt(x, z), size, turn: random() * Math.PI * 2, kind });
    }
  }
  // Loose stones everywhere between.
  for (let i = 0; i < 90 * fine; i++) {
    const a = random() * Math.PI * 2;
    const r = 1 + Math.sqrt(random()) * 17;
    const x = Math.cos(a) * r + 0.5;
    const z = Math.sin(a) * r + 2;
    if (Math.hypot(x - EYE[0], z - EYE[1]) < 0.7) continue;
    if (inClearing(x, z, 0.1)) continue;
    // Loose stones only from the light scans (the moss set's seven stones).
    stones.push({ x, z, y: floorAt(x, z), size: 0.12 + random() ** 2 * 0.35, turn: random() * Math.PI * 2, kind: Math.floor(random() * 7) });
  }
  return stones;
}

// The floor's mesh: rings round a point between the eye and the forest, very fine near it and coarse far off.
function floorGrid(rings: number, spokes: number, reach: number, cx: number, cz: number) {
  const points: number[] = [cx, floorAt(cx, cz), cz];
  const index: number[] = [];
  for (let r = 1; r <= rings; r++) {
    const radius = reach * Math.pow(r / rings, 2.3);
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      points.push(x, floorAt(x, z), z);
    }
  }
  for (let s = 0; s < spokes; s++) index.push(0, 1 + ((s + 1) % spokes), 1 + s);
  for (let r = 1; r < rings; r++)
    for (let s = 0; s < spokes; s++) {
      const a = 1 + (r - 1) * spokes + s;
      const b = 1 + (r - 1) * spokes + ((s + 1) % spokes);
      index.push(a, b, a + spokes, b, b + spokes, a + spokes);
    }
  const whole = new THREE.BufferGeometry();
  whole.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  whole.setIndex(index);
  whole.computeVertexNormals();
  // Cut into pieces sharing the points: the middle out to a few metres, and the rest in wedges, each with its own
  // bounds, so the wedges out of view (behind the eye, mostly) are skipped whole.
  const WEDGES = 12;
  const MIDDLE = 7;
  const inner = Math.ceil(rings * Math.pow(MIDDLE / reach, 1 / 2.3));
  const pieces = Array.from({ length: WEDGES + 1 }, () => [] as number[]);
  const tris = index.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = index[t * 3];
    const ring = a === 0 ? 0 : Math.floor((a - 1) / spokes) + 1;
    const spoke = a === 0 ? 0 : (a - 1) % spokes;
    const piece = ring < inner ? 0 : 1 + Math.floor((spoke / spokes) * WEDGES);
    pieces[piece].push(index[t * 3], index[t * 3 + 1], index[t * 3 + 2]);
  }
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  return pieces.map((list) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", whole.getAttribute("position"));
    g.setAttribute("normal", whole.getAttribute("normal"));
    g.setIndex(list);
    box.makeEmpty();
    for (const i of list) box.expandByPoint(v.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
    // Room for the relief the shader raises it by.
    box.expandByScalar(0.4);
    g.boundingBox = box.clone();
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    return g;
  });
}

// Sand and pebbles: a scan of sand with stones bedded in it, heaving gently, giving way in drifts to clean sand rippled across the swell. Two scales of each, mixed by slow noise, so neither
// visibly repeats.
export function Sand({ assets, tint, fine }: { assets: FloorAssets; tint: string; fine: number }) {
  const sand = useMemo(() => uniform(new THREE.Color(tint)), []);
  sand.value.set(tint);
  const { mesh, pieces, material } = useMemo(() => {
    const pieces = fine > 0.8 ? floorGrid(56, 96, 52, 0.5, 4.5) : fine > 0.6 ? floorGrid(40, 72, 52, 0.5, 4.5) : floorGrid(30, 54, 52, 0.5, 4.5);
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
    const COAST = 2.6;
    const reef = (p: any) => smoothstep(0.18, 0.42, mx_noise_float(vec3(p.x.mul(0.11).add(4), 9.3, p.z.mul(0.11)))) as any;
    const drift = (p: any) => smoothstep(-0.28, 0.22, mx_noise_float(vec3(p.x.mul(0.13), 2.1, p.z.mul(0.13)))) as any;
    const rippleAt = (p: any) => {
      const across = p.x.mul(SWELL.x).add(p.z.mul(SWELL.y)) as any;
      const wander = mx_noise_float(vec3(p.x.mul(0.25), 0, p.z.mul(0.25))).mul(1.4) as any;
      const phase = across.mul(11).add(wander) as any;
      const s = sin(phase) as any;
      return { h: s.mul(0.014), dh: cos(phase).mul(0.014 * 11) };
    };
    const heightAt = (p: any) => {
      const stones = drift(p) as any;
      // The stones themselves are real pebbles and the scan's normals; the bed between them only heaves gently.
      const bed = mx_noise_float(vec3(p.x.mul(1.3), 0.7, p.z.mul(1.3))).mul(0.025) as any;
      // Bedrock breaks through in patches, lumpy and raised.
      const rock = reef(p) as any;
      const lumps = mx_noise_float(vec3(p.x.mul(0.9), 3.3, p.z.mul(0.9))).abs().mul(0.16).add(mx_noise_float(vec3(p.x.mul(2.7), 1.1, p.z.mul(2.7))).mul(0.03)) as any;
      return mix(mix(rippleAt(p).h, bed, stones), lumps, rock);
    };
    const base = positionGeometry as any;
    const near = smoothstep(30, 10, base.xz.sub(vec2(0.5, 4.5)).length()) as any;
    material.positionNode = base.add((vec3 as any)(0, heightAt(base).mul(near), 0)) as any;
    const P = positionWorld as any;
    // The slow patterning (where the stones drift, where bedrock shows, which scale of scan) changes over metres, so it
    // is worked out at the mesh's points, which lie centimetres apart near the eye, and blended between them.
    const stones = varying(drift(base)) as any;
    const wander = varying(mx_noise_float(vec3(base.x.mul(0.25), 0, base.z.mul(0.25))).mul(1.4)) as any;
    const across = P.x.mul(SWELL.x).add(P.z.mul(SWELL.y)) as any;
    const phase = across.mul(11).add(wander) as any;
    const r1 = { h: sin(phase).mul(0.014), dh: cos(phase).mul(0.014 * 11) };
    const coastUv = P.xz.div(COAST) as any;
    const coastFar = P.xz.div(COAST * 2.7).add(vec2(0.31, 0.67)) as any;
    const sandUv = P.xz.mul(0.62) as any;
    const far = varying(smoothstep(-0.3, 0.3, mx_noise_float(vec3(base.x.mul(0.09), 5.1, base.z.mul(0.09))))) as any;
    const coast = texture(assets.coastDiffuse, coastUv).rgb as any;
    const plain = texture(assets.sandDiffuse, sandUv).rgb.mul(r1.h.div(0.014).mul(0.07).add(1)) as any;
    const rock = varying(reef(base)) as any;
    const ROCK = 3.2;
    const rockUv = P.xz.div(ROCK) as any;
    const bedrock = texture(assets.rockDiffuse, rockUv).rgb as any;
    const tone = mix(mix(plain, coast, stones).mul(sand).mul(1.35), bedrock.mul(1.15), rock) as any;
    material.colorNode = tone;
    const flat = (tex: THREE.Texture, at: any, strength: number) => {
      const n = (texture(tex, at) as any).rgb.mul(2).sub(1) as any;
      return vec3(n.x.mul(strength), n.z, n.y.mul(strength)) as any;
    };
    const bump = mix(flat(assets.sandNormal, sandUv, 1), flat(assets.coastNormal, coastUv, 1.4), stones.max(rock)) as any;
    const swell = vec3(SWELL.x, 0, SWELL.y) as any;
    const rippleN = normalize(bump.sub(swell.mul(r1.dh.mul(stones.oneMinus()).mul(rock.oneMinus())))) as any;
    material.normalNode = transformNormalToView(rippleN) as any;
    underSea(material, tone, { normal: rippleN });
    const mesh = new THREE.Group();
    for (const g of pieces) mesh.add(new THREE.Mesh(g, material));
    return { mesh, pieces, material };
  }, [assets, sand, fine]);
  useDispose(...pieces, material);
  return <primitive object={mesh} />;
}

// A bump from any height, by its screen-space slope (after Mikkelsen's "bump mapping unparametrized surfaces"): the
// generated rocks have no UVs or tangents, so the texture's height, laid on from three sides, bends the view-space
// normal directly.
function bumped(height: any, scale: number) {
  const h = (height as any).mul(scale * 0.02) as any;
  const dx = h.dFdx() as any;
  const dy = h.dFdy() as any;
  const sx = (positionView as any).dFdx() as any;
  const sy = (positionView as any).dFdy() as any;
  const n = normalize(normalViewGeometry) as any;
  const r1 = cross(sy, n) as any;
  const r2 = cross(n, sx) as any;
  const det = dot(sx, r1).mul(faceDirection) as any;
  const grad = det.sign().mul(dx.mul(r1).add(dy.mul(r2))) as any;
  return normalize(det.abs().mul(n).sub(grad));
}

// The rocks: every generated stone, each kind drawn as one instanced mesh, crusted on top with pink coralline and green
// weed in patches.
export function Rocks({ assets, stones, crust }: { assets: FloorAssets; stones: Stone[]; crust: string[] }) {
  const tints = useMemo(() => [uniform(new THREE.Color()), uniform(new THREE.Color())], []);
  tints[0].value.set(crust[0]);
  tints[1].value.set(crust[1]);
  const meshes = useMemo(
    () =>
      assets.rocks.slice(0, ROCK_KINDS).map((rock, kind) => {
        const mine = stones.filter((st) => st.kind === kind);
        const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
        // No UVs on a generated rock: its texture is laid on from three sides in its own space, so it is seamless and
        // stays on the stone, and the texture's height (alpha) bumps the surface for the fine relief a scan carried.
        const L = positionGeometry as any;
        const N = normalize(attribute("normal", "vec3")) as any;
        const w = abs(N).pow(4) as any;
        const sum = w.x.add(w.y).add(w.z) as any;
        const K = kind >= 7 ? 1.6 : 2.4;
        const sampled = texture(rock.diffuse, L.zy.mul(K)).mul(w.x).add(texture(rock.diffuse, L.xz.mul(K)).mul(w.y)).add(texture(rock.diffuse, L.xy.mul(K)).mul(w.z)).div(sum) as any;
        const scan = sampled.rgb as any;
        const P = positionWorld as any;
        const top = smoothstep(0.2, 0.75, N.y) as any;
        // Where the crust grows, and which kind, change over tens of centimetres: worked out at the scan's points.
        const patch = varying(smoothstep(-0.15, 0.25, mx_noise_float(P.mul(1.7)))) as any;
        const which = varying(smoothstep(-0.2, 0.2, mx_noise_float(P.mul(0.6).add(9)))) as any;
        const growth = mix(tints[0], tints[1], which) as any;
        const fuzz = scan.g.mul(0.6).add(0.75) as any;
        const tone = mix(scan.mul(0.9), scan.mul(growth).mul(fuzz).mul(2.2), top.mul(patch).mul(0.7)) as any;
        material.colorNode = tone;
        underSea(material, tone, { caustics: "vertex" });
        // The big stones near the middle in full; small ones, and any far off, in the lighter cut.
        const near = (st: Stone) => st.size > 0.55 && Math.hypot(st.x - 0.5, st.z - 3) < 9;
        return [true, false].map((full) => {
          const these = mine.filter((st) => near(st) === full);
          const mesh = new THREE.InstancedMesh(full ? rock.geometry : rock.light, material, Math.max(1, these.length));
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          these.forEach((st, i) => {
            q.setFromEuler(new THREE.Euler(0, st.turn, 0));
            m.compose(new THREE.Vector3(st.x, st.y - st.size * 0.18, st.z), q, new THREE.Vector3(st.size * 1.3, st.size, st.size * 1.2));
            mesh.setMatrixAt(i, m);
          });
          mesh.count = these.length;
          return mesh;
        });
      }).flat(),
    [assets, stones, tints]
  );
  useDispose(...new Set(meshes.map((m) => m.material as THREE.Material)));
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

// Pebbles and cobbles by the thousand, and grit: lumpy low balls, cheap enough to scatter thickly. Pebbles wear the
// scanned rock of the shore laid on from three sides; grit, small stones the colour of the sand, is packed thick on the
// floor in front of the eye's start, where it is seen close. Each is finely divided only within a few metres of the
// start, where its shape shows; further off a coarser ball does, at a quarter of the triangles.
const LOOK_AT = [1.1, 5.2];
function lump(detail: number) {
  // Welded first, so the normals are smooth across the faces rather than each face flat.
  const shape = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute("normal").deleteAttribute("uv"));
  const p = shape.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const bump = 1 + 0.12 * Math.sin(v.x * 3.1 + 1) * Math.sin(v.y * 2.7) + 0.08 * Math.sin(v.z * 5.3 + v.x * 2);
    v.multiplyScalar(bump);
    v.y = v.y * 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  shape.computeVertexNormals();
  return shape;
}

export function Pebbles({ assets, count, plants, tint }: { assets: FloorAssets; count: number; plants: Plant[]; tint: string }) {
  const sandTint = useMemo(() => uniform(new THREE.Color(tint)), []);
  sandTint.value.set(tint);
  const { meshes, shapes, materials } = useMemo(() => {
    // Lightweight pebbles: 80 triangles near, 20 far.
    const shapes = [lump(1), lump(0), lump(0)];
    const P = positionWorld as any;
    const N = normalize(attribute("normal", "vec3")) as any;
    const w = abs(N).pow(4) as any;
    const tri = (tex: THREE.Texture, k: number) => texture(tex, P.yz.mul(k)).mul(w.x).add(texture(tex, P.xz.mul(k)).mul(w.y)).add(texture(tex, P.xy.mul(k)).mul(w.z)).div(w.x.add(w.y).add(w.z)) as any;
    const stone = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    const stoneTone = tri(assets.rockDiffuse, 1.4).rgb.mul(1.15) as any;
    stone.colorNode = stoneTone;
    underSea(stone, stoneTone, { caustics: "vertex" });
    // Grit takes the sand's own tint, each stone a little lighter or darker, warmer or greyer.
    const grit = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    const shade = varying(mx_noise_float(P.mul(9)).mul(0.22).add(1)) as any;
    const gritTone = texture(assets.sandDiffuse, P.xz.mul(2.5)).rgb.mul(sandTint).mul(1.3).mul(shade) as any;
    grit.colorNode = gritTone;
    underSea(grit, gritTone, { caustics: "vertex" });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scatter = (seed: number, total: number, sizes: [number, number], place: (ran