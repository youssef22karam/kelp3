dom: () => number) => [number, number]) => {
      const random = lehmer(seed);
      const near: THREE.Matrix4[] = [];
      const far: THREE.Matrix4[] = [];
      for (let tries = 0; near.length + far.length < total && tries < total * 4; tries++) {
        const [x, z] = place(random);
        if (Math.hypot(x - EYE[0], z - EYE[1]) < 0.4) continue;
        if (plants.some((pl) => Math.hypot(pl.x - x, pl.z - z) < 0.25)) continue;
        const s = sizes[0] + random() ** 2.5 * (sizes[1] - sizes[0]);
        q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.5, random() * Math.PI * 2, (random() - 0.5) * 0.5));
        m.compose(new THREE.Vector3(x, floorAt(x, z) - s * 0.25, z), q, new THREE.Vector3(s * (0.8 + random() * 0.6), s, s * (0.8 + random() * 0.6)));
        (Math.hypot(x - LOOK_AT[0], z - LOOK_AT[1]) < 4 ? near : far).push(m.clone());
      }
      return [near, far];
    };
    const sets = [
      { material: stone, detail: 0, lists: scatter(2909, count, [0.025, 0.155], (random) => {
        const a = random() * Math.PI * 2;
        const r = 0.6 + Math.pow(random(), 0.7) * 16;
        return [Math.cos(a) * r + 0.5, Math.sin(a) * r + 3];
      }) },
      { material: grit, detail: 1, lists: scatter(2917, Math.round(count * 1.1), [0.009, 0.05], (random) => {
        // Most of it packed in front of the start, the rest spread thinly.
        const a = random() * Math.PI * 2;
        if (random() < 0.7) {
          const r = Math.sqrt(random()) * 4.5;
          return [LOOK_AT[0] + Math.cos(a) * r, LOOK_AT[1] + Math.sin(a) * r];
        }
        const r = Math.pow(random(), 0.7) * 14;
        return [Math.cos(a) * r + 0.5, Math.sin(a) * r + 2];
      }) }
    ];
    const meshes = sets.flatMap(({ material, detail, lists }) =>
      lists.map((list, i) => {
        const mesh = new THREE.InstancedMesh(shapes[detail + i], material, Math.max(1, list.length));
        list.forEach((matrix, j) => mesh.setMatrixAt(j, matrix));
        mesh.count = list.length;
        return mesh;
      })
    );
    return { meshes, shapes, materials: [stone, grit] };
  }, [assets, count, plants, sandTint]);
  useDispose(...shapes, ...materials);
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

// Things that grow on the floor, many of one shape: each placed and turned by its own attributes rather than a matrix,
// so the swell can bend it by how high each point is.
type Placed = { x: number; y: number; z: number; size: number; turn: number; hue: number };

// Each placing grown into a clump of two or three close together, the others a little shorter, as grass comes up.
function clumped(placed: Placed[], seed: number, spread: number): Placed[] {
  const random = lehmer(seed);
  return placed.flatMap((p) => {
    const out = [p];
    const more = 1 + Math.floor(random() * 2);
    for (let i = 0; i < more; i++) {
      const a = random() * Math.PI * 2;
      const r = spread * (0.4 + random() * 0.6);
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      out.push({ x, y: p.y + floorAt(x, z) - floorAt(p.x, p.z), z, size: p.size * (0.6 + random() * 0.35), turn: random() * Math.PI * 2, hue: (p.hue + random() * 0.3) % 1 });
    }
    return out;
  });
}

// Tufts in a ring round the foot of each plant given, a little clear of its holdfast.
function aroundHoldfasts(plants: Plant[], each: number): Placed[] {
  const random = lehmer(41);
  return plants.flatMap((p) =>
    Array.from({ length: each }, () => {
      const a = random() * Math.PI * 2;
      const r = (0.32 + random() * 0.55) * p.size;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      return { x, y: floorAt(x, z), z, size: 0.07 + random() ** 1.5 * 0.2, turn: random() * Math.PI * 2, hue: random() };
    })
  );
}

// Little grass round the foot of each: a few short tufts close about it.
function skirts(placed: Placed[], seed: number, each: number, sizes: [number, number]): Placed[] {
  const random = lehmer(seed);
  return placed.flatMap((p) =>
    Array.from({ length: each }, () => {
      const a = random() * Math.PI * 2;
      const r = 0.04 + random() * 0.12;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      return { x, y: p.y + floorAt(x, z) - floorAt(p.x, p.z), z, size: sizes[0] + random() * (sizes[1] - sizes[0]), turn: random() * Math.PI * 2, hue: random() };
    })
  );
}

function grower(shape: THREE.BufferGeometry, placed: Placed[], palette: string[], options: { bend: number; height: number; rough?: number; tone?: (base: any, local: any) => any; glow?: number }) {
  // Nothing that sways grows on the crabs' clearing.
  if (options.bend > 0) placed = placed.filter((p) => !inClearing(p.x, p.z));
  const geometry = new THREE.InstancedBufferGeometry();
  for (const name of ["position", "normal"]) geometry.setAttribute(name, shape.getAttribute(name));
  geometry.setIndex(shape.getIndex());
  const at = new Float32Array(placed.length * 4);
  const turn = new Float32Array(placed.length * 4);
  placed.forEach((p, i) => {
    at.set([p.x, p.y, p.z, p.size], i * 4);
    turn.set([p.turn, p.hue, Math.random() * 100, 0], i * 4);
  });
  geometry.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 4));
  geometry.setAttribute("aTurn", new THREE.InstancedBufferAttribute(turn, 4));
  geometry.instanceCount = placed.length;
  const material = new THREE.MeshStandardNodeMaterial({ roughness: options.rough ?? 0.7, side: THREE.DoubleSide });
  const A = attribute("aAt", "vec4") as any;
  const R = attribute("aTurn", "vec4") as any;
  const spin = (v: any) => vec3(v.x.mul(cos(R.x)).sub(v.z.mul(sin(R.x))), v.y, v.x.mul(sin(R.x)).add(v.z.mul(cos(R.x)))) as any;
  const local = positionGeometry as any;
  const placedAt = () => {
    const rest = A.xyz.add(spin(local).mul(A.w)) as any;
    const high = local.y.div(options.height).clamp(0, 1) as any;
    const flutter = sin(sea.clock.mul(1.7).add(R.z).add(local.y.mul(9))).mul(0.15) as any;
    const off = swayAt(A.xyz).mul(high.mul(high).mul(options.bend).mul(A.w).mul(flutter.add(1))) as any;
    // Bent over rather than stretched: the further a point is carried aside, the lower it comes, keeping its length.
    const h = local.y.mul(A.w).max(0) as any;
    const aside = off.x.mul(off.x).add(off.z.mul(off.z)) as any;
    const drop = h.sub(sqrt(max(h.mul(h).sub(aside), h.mul(h).mul(0.08)))) as any;
    return rest.add(off).sub(vec3(0, drop, 0));
  };
  material.positionNode = placedAt();
  const normal = varying(spin(attribute("normal", "vec3"))) as any;
  material.normalNode = transformNormalToView(normalize(normal)) as any;
  const colours = palette.map((c) => color(c));
  const hue = R.y as any;
  let base: any = colours[0];
  colours.forEach((c, i) => {
    if (i > 0) base = mix(base, c, hue.mul(palette.length).greaterThan(i).select(1, 0));
  });
  const tone = options.tone ? options.tone(base, varying(local)) : base;
  material.colorNode = tone;
  underSea(material, tone, { normal, caustics: "vertex", through: tone.mul(0.25), extra: options.glow ? tone.mul(options.glow) : undefined });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// Spots for growers: round the outcrops and over the sand, never under a kelp or in the eye's way.
// Out to near from the middle, or, given at, packed round that point instead.
function spots(seed: number, count: number, stones: Stone[], plants: Plant[], near: number, sizes: [number, number], onRock = 0.6, at?: [number, number]) {
  const random = lehmer(seed);
  const out: Placed[] = [];
  const big = stones.filter((s) => s.size > 0.5);
  let tries = 0;
  while (out.length < count && tries++ < count * 20) {
    let x: number;
    let z: number;
    if (random() < onRock && big.length) {
      const s = big[Math.floor(random() * big.length)];
      const a = random() * Math.PI * 2;
      const r = s.size * (0.55 + random() * 0.7);
      x = s.x + Math.cos(a) * r;
      z = s.z + Math.sin(a) * r;
    } else {
      const a = random() * Math.PI * 2;
      const r = at ? Math.sqrt(random()) * near : 0.8 + Math.sqrt(random()) * near;
      x = (at?.[0] ?? 0) + Math.cos(a) * r;
      z = (at?.[1] ?? 0) + Math.sin(a) * r;
    }
    // Clear of the eye itself at the start, low in the grass.
    if (Math.hypot(x - EYE[0], z - EYE[1]) < 0.45) continue;
    if (plants.some((p) => Math.hypot(p.x - x, p.z - z) < 0.3)) continue;
    // On top of a rock, if it lies on one.
    let y = floorAt(x, z);
    for (const s of stones) {
      const d = Math.hypot(s.x - x, s.z - z) / (s.size * 0.6);
      if (d < 1) y = Math.max(y, s.y + s.size * 0.75 * Math.sqrt(1 - d * d) - s.size * 0.15);
    }
    out.push({ x, y, z, size: sizes[0] + random() ** 2 * (sizes[1] - sizes[0]), turn: random() * Math.PI * 2, hue: random() });
  }
  return out;
}

// Meadows: tufts gathered thick round a few middles on the sand, thinning toward their edges.
function meadows(seed: number, count: number, middles: number, plants: Plant[], sizes: [number, number]) {
  const random = lehmer(seed);
  const centres = Array.from({ length: middles }, () => {
    const a = random() * Math.PI * 2;
    const r = 1.5 + Math.sqrt(random()) * 13;
    return { x: Math.cos(a) * r + 0.5, z: Math.sin(a) * r + 2, wide: 0.8 + random() * 1.6 };
  });
  const out: Placed[] = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 10) {
    const c = centres[Math.floor(random() * centres.length)];
    const a = random() * Math.PI * 2;
    const r = (random() + random()) * 0.5 * c.wide * 1.4;
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    if (Math.hypot(x - EYE[0], z - EYE[1]) < 0.45) continue;
    if (plants.some((p) => Math.hypot(p.x - x, p.z - z) < 0.3)) continue;
    const edge = 1 - r / (c.wide * 1.4);
    out.push({ x, y: floorAt(x, z), z, size: (sizes[0] + random() * (sizes[1] - sizes[0])) * (0.6 + edge * 0.4), turn: random() * Math.PI * 2, hue: random() });
  }
  return out;
}

// --- Shapes, each one unit tall, standing on y = 0. ---

// A sea urchin: a ball of long spines.
function urchinShape() {
  const random = lehmer(311);
  const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.42, 7, 5)];
  for (let i = 0; i < 20; i++) {
    const d = new THREE.Vector3(random() - 0.5, random() * 0.9 - 0.25, random() - 0.5).normalize();
    const spine = new THREE.ConeGeometry(0.03, 0.6 + random() * 0.3, 3, 1);
    spine.translate(0, 0.42 + 0.3, 0);
    spine.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    parts.push(spine);
  }
  const g = merge(parts.map((p) => p.toNonIndexed()));
  g.translate(0, 0.3, 0);
  return g;
}

// A sea star: five plump arms tapering from a raised middle.
function starShape() {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 25; i++) {
    const a = (i / 25) * Math.PI * 2;
    const arm = Math.pow(Math.abs(Math.cos((a * 5) / 2)), 3);
    const r = 0.16 + 0.34 * arm;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1, curveSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.05, 0);
  return g;
}

// A tuft of weed: blades from one point, curving over.
function tuftShape(blades: number, salt: number, wide: number) {
  const random = lehmer(salt);
  const parts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < blades; b++) {
    const a = random() * Math.PI * 2;
    const tall = 0.5 + random() * 0.5;
    const lean = 0.15 + random() * 0.35;
    const pts: number[] = [];
    const idx: number[] = [];
    const segs = 3;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const w = wide * (1 - u * 0.8);
      const x = Math.cos(a) * lean * u * u;
      const z = Math.sin(a) * lean * u * u;
      pts.push(x - Math.sin(a) * w, tall * u, z + Math.cos(a) * w, x + Math.sin(a) * w, tall * u, z - Math.cos(a) * w);
      if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g.toNonIndexed());
  }
  return merge(parts);
}

// An anemone: a short column and a crown of tentacles, swaying.
function anemoneShape() {
  const random = lehmer(707);
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.22, 0.28, 0.35, 8, 1).translate(0, 0.17, 0).toNonIndexed()];
  for (let i = 0; i < 14; i++) {
    const a = random() * Math.PI * 2;
    const r = 0.06 + random() * 0.17;
    const out = new THREE.Vector3(Math.cos(a), 1.6 + random(), Math.sin(a)).normalize();
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(Math.cos(a) * r, 0.34, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * r, 0.34, Math.sin(a) * r).addScaledVector(out, 0.3), new THREE.Vector3(Math.cos(a) * (r + 0.25), 0.75 + random() * 0.2, Math.sin(a) * (r + 0.25)));
    parts.push(new THREE.TubeGeometry(curve, 3, 0.022, 3, false).toNonIndexed());
  }
  return merge(parts);
}

export function Growth({ stones, plants, fine }: { stones: Stone[]; plants: Plant[]; fine: number }) {
  const meshes = useMemo(() => {
    const n = (count: number) => Math.max(4, Math.round(count * fine));
    const surf = spots(15, n(120), stones, plants, 14, [0.65, 1.25], 0.15);
    const turf = spots(17, n(110), stones, plants, 12, [0.16, 0.34], 0.4);
    return [
      grower(urchinShape(), spots(11, n(24), stones, plants, 9, [0.08, 0.13], 0.8), ["#3b1a4a", "#5b1f5c", "#24162e"], { bend: 0, height: 1, rough: 0.5 }),
      grower(starShape(), spots(12, n(14), stones, plants, 10, [0.15, 0.25], 0.6), ["#d45a1c", "#7a2a6a", "#c8402a", "#e09a3a"], { bend: 0, height: 1, rough: 0.8 }),
      grower(tuftShape(6, 41, 0.045), spots(13, n(140), stones, plants, 13, [0.28, 0.6], 0.5), ["#7a2a24", "#a2462a", "#5a6a26", "#3f5a22"], { bend: 0.5, height: 1 }),
      // Surfgrass: long bright ribbons scattered over the sand, and gathered into meadows, streaming with the water.
      grower(tuftShape(6, 47, 0.018), surf, ["#3a6a2a", "#4a742e", "#567e34"], { bend: 0.9, height: 1 }),
      grower(tuftShape(7, 53, 0.024), meadows(16, n(200), n(14), plants, [0.5, 1.05]), ["#36602a", "#44702c", "#527a34", "#5e823c"], { bend: 0.9, height: 1 }),
      // Tiny grass in front of the eye's start.
      grower(tuftShape(5, 67, 0.013), spots(18, n(180), stones, plants, 3.2, [0.07, 0.16], 0.1, [1.1, 5.4]), ["#4e6a2a", "#5a7430", "#6a7a34", "#3e5a24"], { bend: 0.7, height: 1 }),
      // Grass and weed around holdfasts.
      grower(tuftShape(5, 73, 0.014), aroundHoldfasts(plants.slice(0, 4), 10), ["#4e6a2a", "#5a7430", "#6a6a2c", "#7a3a24"], { bend: 0.6, height: 1 }),
      // Short fine turf among the stones.
      grower(tuftShape(5, 59, 0.02), turf, ["#4a6426", "#5e6e2c", "#3e5a26"], { bend: 0.6, height: 1 }),
      grower(anemoneShape(), spots(14, n(14), stones, plants, 8, [0.15, 0.25], 0.85), ["#4fa86a", "#d06a8a", "#e8c070"], { bend: 0.3, height: 0.9, tone: (base, local) => mix(base.mul(0.6), base.mul(1.3), smoothstep(0.3, 0.9, local.y)) })
    ];
  }, [stones, plants, fine]);
  useDispose(...meshes.flatMap((m) => [m.geometry, m.material as THREE.Material]));
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

