import * as THREE from "three/webgpu";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { lehmer } from "./engine/random";

// Everything the original loaded from scans (Poly Haven sand, coast and rock textures, and four GLTF rock sets) is
// grown here from noise instead: no files, no network. Textures tile seamlessly (every noise is periodic over the tile)
// and carry their height in alpha; rocks are sculpted spheres, lumped by 3D noise, chipped flat by fracture planes and
// worn round, each kind in a full and a light cut over the same shape.

// ---------------------------------------------------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------------------------------------------------

function permutation(seed: number) {
  const random = lehmer(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const wrap = (i: number, period: number) => ((i % period) + period) % period;

// 2D gradient noise that repeats every `period` units, so a texture made from it tiles.
class TileNoise {
  perm: Uint8Array;
  gx = new Float32Array(256);
  gy = new Float32Array(256);
  constructor(seed: number) {
    this.perm = permutation(seed);
    const random = lehmer(seed + 17);
    for (let i = 0; i < 256; i++) {
      const a = random() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }
  private dot(ix: number, iy: number, period: number, dx: number, dy: number) {
    const h = this.perm[(this.perm[wrap(ix, period) & 255] + wrap(iy, period)) & 255];
    return this.gx[h] * dx + this.gy[h] * dy;
  }
  // Roughly in [-0.7, 0.7].
  noise(x: number, y: number, period: number) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const v = fade(fy);
    const a = this.dot(ix, iy, period, fx, fy);
    const b = this.dot(ix + 1, iy, period, fx - 1, fy);
    const c = this.dot(ix, iy + 1, period, fx, fy - 1);
    const d = this.dot(ix + 1, iy + 1, period, fx - 1, fy - 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  // Fractal sum over the tile (u, v in [0, 1)), starting at `base` cells across.
  fbm(u: number, v: number, base: number, octaves: number, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = base;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(u * f, v * f, f) * amp;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
  ridged(u: number, v: number, base: number, octaves: number) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = base;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise(u * f, v * f, f) * 1.4);
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

// Cellular noise over a tile of `cells` × `cells`: the nearest two feature points and the nearest one's cell.
class TileCells {
  px: Float32Array;
  py: Float32Array;
  hash: Float32Array;
  constructor(public cells: number, seed: number) {
    const random = lehmer(seed);
    const n = cells * cells;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.hash = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.px[i] = 0.1 + random() * 0.8;
      this.py[i] = 0.1 + random() * 0.8;
      for (let k = 0; k < 4; k++) this.hash[i * 4 + k] = random();
    }
  }
  at(u: number, v: number, out: { f1: number; f2: number; id: number; dx: number; dy: number }) {
    const c = this.cells;
    const x = u * c;
    const y = v * c;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 1e9;
    let f2 = 1e9;
    let id = 0;
    let bdx = 0;
    let bdy = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const k = wrap(cy, c) * c + wrap(cx, c);
        const dx = cx + this.px[k] - x;
        const dy = cy + this.py[k] - y;
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = k;
          bdx = dx;
          bdy = dy;
        } else if (d < f2) f2 = d;
      }
    out.f1 = Math.sqrt(f1);
    out.f2 = Math.sqrt(f2);
    out.id = id;
    out.dx = bdx;
    out.dy = bdy;
    return out;
  }
}

// Classic 3D Perlin noise for sculpting rocks (not tiled).
class Noise3 {
  perm: Uint8Array;
  constructor(seed: number) {
    this.perm = permutation(seed);
  }
  private grad(h: number, x: number, y: number, z: number) {
    const g = h & 15;
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
    return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
  }
  noise(x: number, y: number, z: number) {
    const p = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    return lerp(
      lerp(lerp(this.grad(p[AA], x, y, z), this.grad(p[BA], x - 1, y, z), u), lerp(this.grad(p[AB], x, y - 1, z), this.grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(this.grad(p[AA + 1], x, y, z - 1), this.grad(p[BA + 1], x - 1, y, z - 1), u), lerp(this.grad(p[AB + 1], x, y - 1, z - 1), this.grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w
    );
  }
  fbm(x: number, y: number, z: number, octaves: number, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * f, y * f, z * f) * amp;
      norm += amp;
      amp *= gain;
      f *= 2.03;
    }
    return sum / norm;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------------------

type RGB = [number, number, number];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// A tile drawn by `paint`, which writes colour (sRGB, 0–1) and height (0–1) for each texel. Returns the colour map
// (height in alpha) and a tangent-space normal map from the height.
function bake(size: number, strength: number, paint: (u: number, v: number, out: { c: RGB; h: number }) => void) {
  const colour = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const out = { c: [0, 0, 0] as RGB, h: 0 };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      paint((x + 0.5) / size, (y + 0.5) / size, out);
      const i = y * size + x;
      height[i] = out.h;
      colour[i * 4] = Math.round(clamp01(out.c[0]) * 255);
      colour[i * 4 + 1] = Math.round(clamp01(out.c[1]) * 255);
      colour[i * 4 + 2] = Math.round(clamp01(out.c[2]) * 255);
      colour[i * 4 + 3] = Math.round(clamp01(out.h) * 255);
    }
  const normal = new Uint8Array(size * size * 4);
  const k = strength * (size / 512);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const d = height[((y - 1 + size) % size) * size + x];
      const u = height[((y + 1) % size) * size + x];
      let nx = -(r - l) * k;
      let ny = -(u - d) * k;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      normal[i] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  return { diffuse: toTexture(colour, size, true), normal: toTexture(normal, size, false) };
}

function toTexture(data: Uint8Array, size: number, colour: boolean) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hash2 = (x: number, y: number, s: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

// Clean sand: pale grains of quartz and shell with a scatter of dark mineral grains, faint drifts of colour, and a fine
// grainy relief.
function sandTexture(size: number) {
  const n = new TileNoise(101);
  const light: RGB = [0.8, 0.72, 0.58];
  const dark: RGB = [0.62, 0.54, 0.42];
  return bake(size, 2.2, (u, v, o) => {
    const drift = n.fbm(u, v, 4, 4) * 0.5 + 0.5;
    const fine = n.fbm(u, v, 48, 3);
    const gx = Math.floor(u * size * 0.7);
    const gy = Math.floor(v * size * 0.7);
    const g = hash2(gx % Math.floor(size * 0.7), gy % Math.floor(size * 0.7), 3);
    let c = mixRGB(dark, light, drift * 0.7 + 0.15 + fine * 0.25);
    if (g < 0.06) c = mixRGB(c, [0.22, 0.2, 0.18], 0.75);
    else if (g < 0.1) c = mixRGB(c, [0.6, 0.38, 0.26], 0.5);
    else if (g > 0.95) c = mixRGB(c, [0.98, 0.96, 0.9], 0.6);
    const tone = 0.9 + hash2(u * size, v * size, 9) * 0.2;
    o.c = [c[0] * tone, c[1] * tone, c[2] * tone];
    o.h = clamp01(0.5 + fine * 0.35 + (g - 0.5) * 0.18 + n.fbm(u, v, 12, 3) * 0.2);
  });
}

// Sand with stones bedded in it: cobbles and pebbles of grey, brown and dark stone, each mottled, half sunk in the sand,
// in two sizes.
function coastTexture(size: number) {
  const n = new TileNoise(202);
  const big = new TileCells(11, 203);
  const small = new TileCells(27, 204);
  const cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const palette: RGB[] = [
    [0.46, 0.44, 0.42],
    [0.36, 0.33, 0.3],
    [0.55, 0.5, 0.44],
    [0.28, 0.27, 0.27],
    [0.52, 0.42, 0.34],
    [0.62, 0.6, 0.56],
    [0.4, 0.36, 0.3],
    [0.2, 0.2, 0.21]
  ];
  const sandLight: RGB = [0.74, 0.66, 0.52];
  const sandDark: RGB = [0.56, 0.49, 0.38];
  const stone = (cells: TileCells, u: number, v: number, warp: number) => {
    cells.at(u + n.noise(u * 16, v * 16, 16) * warp, v + n.noise(u * 16 + 7, v * 16 + 3, 16) * warp, cell);
    const h = cells.hash;
    const k = cell.id * 4;
    // Each stone an ellipse turned its own way, of its own size.
    const a = h[k] * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const ex = cell.dx * ca + cell.dy * sa;
    const ey = -cell.dx * sa + cell.dy * ca;
    const stretch = 0.65 + h[k + 1] * 0.5;
    const r = 0.28 + h[k + 2] * 0.2;
    const d = Math.hypot(ex / stretch, ey * stretch) / r;
    return { d, k, present: h[k + 3] < 0.82 };
  };
  return bake(size, 4, (u, v, o) => {
    const drift = n.fbm(u, v, 3, 4) * 0.5 + 0.5;
    const grain = hash2(u * size, v * size, 5);
    let c = mixRGB(sandDark, sandLight, clamp01(drift * 0.8 + n.fbm(u, v, 40, 2) * 0.3));
    if (grain < 0.05) c = mixRGB(c, [0.25, 0.23, 0.2], 0.6);
    let h = 0.25 + n.fbm(u, v, 30, 3) * 0.08;
    for (const [cells, lift] of [
      [small, 0.55],
      [big, 1]
    ] as [TileCells, number][]) {
      const s = stone(cells, u, v, cells === big ? 0.012 : 0.006);
      if (!s.present || s.d >= 1) continue;
      const dome = Math.sqrt(1 - s.d * s.d);
      const edge = smooth(1, 0.82, s.d);
      const hh = cells.hash;
      const base = palette[Math.floor(hh[s.k + 1] * 7.99)];
      const mottle = n.fbm(u, v, 64, 3) * 0.5 + 0.5;
      const vein = Math.abs(n.noise(u * 90 + hh[s.k] * 50, v * 90, 90)) < 0.03 && hh[s.k + 2] > 0.6 ? 1 : 0;
      let sc = mixRGB(base, [base[0] * 1.25, base[1] * 1.22, base[2] * 1.18], mottle);
      sc = mixRGB(sc, [0.85, 0.83, 0.78], vein * 0.6);
      // Wet-dark where it sinks into the sand.
      sc = mixRGB([sc[0] * 0.7, sc[1] * 0.7, sc[2] * 0.7], sc, smooth(0, 0.5, dome));
      c = mixRGB(c, sc, edge);
      h = Math.max(h, 0.25 + dome * 0.75 * lift + mottle * 0.03);
    }
    o.c = c;
    o.h = clamp01(h);
  });
}

// Low-tide rock: grey-brown stone, ridged and cracked, with crusts of pink coralline, dark weed and pale barnacle specks.
function rockTexture(size: number, seed: number, look: { base: RGB; dark: RGB; growth: RGB; growthAmount: number; specks: number; cracks: number }) {
  const n = new TileNoise(seed);
  const cracks = new TileCells(7, seed + 1);
  const cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  return bake(size, 5, (u, v, o) => {
    const ridge = n.ridged(u, v, 3, 5);
    const body = n.fbm(u, v, 5, 5) * 0.5 + 0.5;
    cracks.at(u + n.noise(u * 8, v * 8, 8) * 0.03, v + n.noise(u * 8 + 5, v * 8, 8) * 0.03, cell);
    const crack = smooth(0.06, 0.0, cell.f2 - cell.f1) * look.cracks;
    let c = mixRGB(look.dark, look.base, clamp01(body * 0.8 + ridge * 0.4 - 0.1));
    const patch = smooth(0.05, 0.25, n.fbm(u + 0.3, v + 0.7, 4, 4));
    c = mixRGB(c, look.growth, patch * look.growthAmount * (0.6 + 0.4 * n.fbm(u, v, 32, 2)));
    const speck = hash2(Math.floor(u * size * 0.5), Math.floor(v * size * 0.5), seed);
    if (speck > 1 - look.specks) c = mixRGB(c, [0.86, 0.84, 0.78], 0.7);
    c = mixRGB(c, [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35], crack);
    const grain = 0.92 + hash2(u * size, v * size, seed + 3) * 0.16;
    o.c = [c[0] * grain, c[1] * grain, c[2] * grain];
    o.h = clamp01(ridge * 0.55 + body * 0.35 + n.fbm(u, v, 40, 3) * 0.1 - crack * 0.4 + 0.05);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------------------------------------------------

type RockShape = {
  seed: number;
  lump: number; // how far noise pushes the surface in and out
  frequency: number;
  ridges: number; // sharp creases
  cuts: number; // fracture planes
  cutDepth: number; // how deep the planes cut (lower = more cut away)
  squash: [number, number, number];
  bottom: number; // where the underside is flattened
};

// The ten kinds: seven rounded, mossy stones (light, used everywhere), two angular blocks and one big weathered
// boulder, as the original's scanned sets were.
const SHAPES: RockShape[] = [
  { seed: 11, lump: 0.22, frequency: 1.1, ridges: 0.04, cuts: 2, cutDepth: 0.78, squash: [1.2, 0.62, 0.95], bottom: -0.35 },
  { seed: 12, lump: 0.28, frequency: 1.3, ridges: 0.05, cuts: 3, cutDepth: 0.74, squash: [1, 0.7, 1.1], bottom: -0.4 },
  { seed: 13, lump: 0.18, frequency: 0.9, ridges: 0.03, cuts: 1, cutDepth: 0.8, squash: [1.3, 0.55, 0.9], bottom: -0.3 },
  { seed: 14, lump: 0.3, frequency: 1.5, ridges: 0.06, cuts: 4, cutDepth: 0.72, squash: [0.95, 0.8, 1], bottom: -0.45 },
  { seed: 15, lump: 0.24, frequency: 1.2, ridges: 0.05, cuts: 2, cutDepth: 0.76, squash: [1.15, 0.66, 1.2], bottom: -0.38 },
  { seed: 16, lump: 0.2, frequency: 1, ridges: 0.04, cuts: 3, cutDepth: 0.8, squash: [1.05, 0.58, 0.85], bottom: -0.32 },
  { seed: 17, lump: 0.26, frequency: 1.4, ridges: 0.05, cuts: 2, cutDepth: 0.75, squash: [1.25, 0.72, 1], bottom: -0.42 },
  { seed: 18, lump: 0.2, frequency: 1.6, ridges: 0.09, cuts: 7, cutDepth: 0.62, squash: [1.1, 0.9, 0.95], bottom: -0.5 },
  { seed: 19, lump: 0.24, frequency: 1.8, ridges: 0.1, cuts: 6, cutDepth: 0.6, squash: [1.3, 0.75, 1], bottom: -0.45 },
  { seed: 20, lump: 0.32, frequency: 0.8, ridges: 0.07, cuts: 4, cutDepth: 0.7, squash: [1.2, 0.85, 1.1], bottom: -0.55 }
];

function sculpt(shape: RockShape, detail: number) {
  const noise = new Noise3(shape.seed * 13 + 5);
  const random = lehmer(shape.seed * 101 + 7);
  const offset = [random() * 50, random() * 50, random() * 50];
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < shape.cuts; i++) {
    const n = new THREE.Vector3(random() - 0.5, (random() - 0.3) * 0.9, random() - 0.5).normalize();
    planes.push({ n, d: shape.cutDepth + random() * 0.18 });
  }
  const sphere = new THREE.IcosahedronGeometry(1, detail);
  sphere.deleteAttribute("normal");
  sphere.deleteAttribute("uv");
  const g = mergeVertices(sphere);
  sphere.dispose();
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const f = shape.frequency;
    const x = v.x * f + offset[0];
    const y = v.y * f + offset[1];
    const z = v.z * f + offset[2];
    let r = 1 + noise.fbm(x, y, z, 5) * shape.lump * 2;
    // Creases: ridged noise cut into the surface.
    const crease = 1 - Math.abs(noise.noise(x * 3.1 + 9, y * 3.1, z * 3.1) * 1.6);
    r -= Math.pow(Math.max(0, crease), 6) * shape.ridges;
    // Fine pitting.
    r += noise.fbm(x * 6, y * 6, z * 6, 3) * 0.025;
    v.multiplyScalar(r);
    // Fractures: anything past a plane is pushed back toward it, leaving flat, slightly worn faces.
    for (const plane of planes) {
      const over = v.dot(plane.n) - plane.d;
      if (over > 0) v.addScaledVector(plane.n, -over * 0.92);
    }
    v.set(v.x * shape.squash[0], v.y * shape.squash[1], v.z * shape.squash[2]);
    // A flattened, softly rounded underside where it beds into the sand.
    if (v.y < shape.bottom * shape.squash[1] * 1.6) {
      const floor = shape.bottom * shape.squash[1] * 1.6;
      v.y = floor + (v.y - floor) * 0.25;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // Standing on y = 0, centred, one unit at its largest, as the scans were prepared.
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const middle = box.getCenter(new THREE.Vector3());
  g.translate(-middle.x, -box.min.y, -middle.z);
  const largest = Math.max(size.x, size.y, size.z);
  g.scale(1 / largest, 1 / largest, 1 / largest);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// The floor's assets, all generated
// ---------------------------------------------------------------------------------------------------------------------

export type Rock = { geometry: THREE.BufferGeometry; light: THREE.BufferGeometry; diffuse: THREE.Texture; normal: THREE.Texture };

function generateFloor(fine: boolean) {
  const big = fine ? 512 : 256;
  const rockRes = 256;
  const sand = sandTexture(big);
  const coast = coastTexture(big);
  const lowTide = rockTexture(rockRes, 303, { base: [0.5, 0.46, 0.4], dark: [0.24, 0.22, 0.2], growth: [0.36, 0.34, 0.18], growthAmount: 0.5, specks: 0.03, cracks: 1 });
  const mossy = rockTexture(rockRes, 404, { base: [0.46, 0.45, 0.4], dark: [0.2, 0.21, 0.19], growth: [0.3, 0.38, 0.16], growthAmount: 0.85, specks: 0.015, cracks: 0.4 });
  const granite = rockTexture(rockRes, 505, { base: [0.6, 0.55, 0.5], dark: [0.32, 0.28, 0.26], growth: [0.48, 0.36, 0.3], growthAmount: 0.35, specks: 0.06, cracks: 0.8 });
  const rocks: Rock[] = SHAPES.map((shape, kind) => {
    const look = kind < 7 ? mossy : kind < 9 ? lowTide : granite;
    return {
      // IcosahedronGeometry(1, detail) produces 20*(detail+1)^2 triangles: detail 3..4 = 320..500 tris, light 1..2 = 80..180 tris.
      geometry: sculpt(shape, fine ? (kind >= 7 ? 4 : 3) : kind >= 7 ? 3 : 2),
      light: sculpt(shape, kind >= 7 ? 2 : 1),
      diffuse: look.diffuse,
      normal: look.normal
    };
  });
  return {
    coastDiffuse: coast.diffuse,
    coastNormal: coast.normal,
    coastHeight: coast.diffuse,
    sandDiffuse: sand.diffuse,
    sandNormal: sand.normal,
    rockDiffuse: lowTide.diffuse,
    rockNormal: lowTide.normal,
    rocks
  };
}

export type FloorAssets = ReturnType<typeof generateFloor>;

const cache = new Map<boolean, FloorAssets>();
export function floorAssets(fine: boolean) {
  let assets = cache.get(fine);
  if (!assets) {
    assets = generateFloor(fine);
    cache.set(fine, assets);
  }
  return assets;
}
