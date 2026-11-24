scratchLoop);
        return out.copy(loop).lerp(pass, w);
      }
    }
    return this.loop(a, o, out);
  }

  private loop(a: number, o: number, out: THREE.Vector3) {
    const [cx, cz] = this.fish.kind.centre ?? [0, 0];
    return out.set((Math.cos(a) * 6 + Math.sin(a * 2.3) * 1.5) * o + cx, (this.fish.kind.height[0] + this.fish.kind.height[1]) / 2 + Math.sin(a * 1.7) * 1.2, (Math.sin(a) * 4.5 + Math.cos(a * 1.3) * 1.5) * o - 1 + cz);
  }

  step(delta: number, stirs: Stir[]) {
    if (!(delta > 1e-5)) return;
    this.time += delta;
    const f = this.fish;
    const k = f.kind;
    const lead = this.leader(this.time, new THREE.Vector3());
    const ahead = this.leader(this.time + 0.5, new THREE.Vector3()).sub(lead);
    // How the leader is going, for each fish to match.
    const lvx = ahead.x / 0.5;
    const lvy = ahead.y / 0.5;
    const lvz = ahead.z / 0.5;
    const turn = Math.atan2(ahead.z, ahead.x);
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const toP = new THREE.Vector3();
    for (let i = 0; i < f.count; i++) {
      const o = i * 3;
      let tx: number;
      let ty: number;
      let tz: number;
      // The speed it would like to be going: the school's, or along its own wandering path.
      let wx = lvx;
      let wy = lvy;
      let wz = lvz;
      if (k.solo) {
        // Its own patch, wandered slowly round.
        const rate = 0.15 * k.speed;
        const w = this.time * rate + i * 7.1;
        tx = f.home[o] + Math.sin(w) * 1.2;
        ty = f.home[o + 1] + Math.sin(w * 0.7) * 0.3;
        tz = f.home[o + 2] + Math.cos(w * 1.3) * 1.2;
        wx = Math.cos(w) * 1.2 * rate;
        wy = Math.cos(w * 0.7) * 0.21 * rate;
        wz = -Math.sin(w * 1.3) * 1.56 * rate;
      } else {
        const sx = f.slot[o];
        const sz = f.slot[o + 2];
        const w = this.time * 0.6 + i;
        tx = lead.x + sx * c - sz * s + Math.sin(w) * 0.15;
        ty = lead.y + f.slot[o + 1] + Math.sin(w * 1.3) * 0.1;
        tz = lead.z + sx * s + sz * c + Math.cos(w * 0.9) * 0.15;
      }
      const px = f.position[o];
      const py = f.position[o + 1];
      const pz = f.position[o + 2];
      // Steered to match that speed while easing toward its place: well damped, so a fish swims steadily along with its
      // school instead of springing at a point and swinging its head about round it.
      let ax = (tx - px) * 0.9 + (wx - f.velocity[o]) * 1.6;
      let ay = (ty - py) * 0.9 + (wy - f.velocity[o + 1]) * 1.8;
      let az = (tz - pz) * 0.9 + (wz - f.velocity[o + 2]) * 1.6;
      // Away from the pointer's line through the water, and from bursts.
      for (const st of stirs) {
        const fade = Math.exp(-st.age * 2);
        if (st.burst > 0) {
          toP.set(px - st.at.x, py - st.at.y, pz - st.at.z);
        } else {
          toP.set(px - st.origin.x, py - st.origin.y, pz - st.origin.z);
          const along = toP.dot(st.dir);
          if (along <= 0) continue;
          toP.addScaledVector(st.dir, -along);
        }
        const d = toP.length() + 1e-3;
        const reach = st.burst > 0 ? 2.2 : 1.1;
        if (d < reach) {
          const push = (14 * fade * (1 - d / reach)) / d;
          ax += toP.x * push;
          ay += toP.y * push * 0.5;
          az += toP.z * push;
        }
      }
      // Round the kelp, not through it: near a plant's stipes at this height, pushed out from their middle, harder the
      // closer, and whatever of its speed heads inward taken away, so it slides round the outside.
      if (kelpColumns.plants) {
        const band = bandOf(py);
        const cols = kelpColumns.data;
        for (let pl = 0; pl < kelpColumns.plants; pl++) {
          const at = (pl * BANDS + band) * 4;
          const spread = cols[at + 2];
          if (spread < 0) continue;
          const dx = px - cols[at];
          const dz = pz - cols[at + 1];
          const reach = spread + 0.3 + f.size[i];
          const d2 = dx * dx + dz * dz;
          if (d2 > reach * reach) continue;
          const d = Math.sqrt(d2) + 1e-4;
          const push = (10 * (1 - d / reach)) / d;
          ax += dx * push;
          az += dz * push;
          const inward = (f.velocity[o] * dx + f.velocity[o + 2] * dz) / d;
          if (inward < 0) {
            ax -= (dx / d) * inward * 4;
            az -= (dz / d) * inward * 4;
          }
        }
      }
      let vx = f.velocity[o] + ax * delta;
      let vy = f.velocity[o + 1] + ay * delta;
      let vz = f.velocity[o + 2] + az * delta;
      const speed = Math.hypot(vx, vy, vz);
      const most = k.speed * 3.5;
      if (speed > most) {
        vx *= most / speed;
        vy *= most / speed;
        vz *= most / speed;
      }
      f.velocity[o] = vx;
      f.velocity[o + 1] = vy;
      f.velocity[o + 2] = vz;
      let nx = px + vx * delta;
      let ny = py + vy * delta;
      let nz = pz + vz * delta;
      ny = Math.min(SURFACE - 0.4, Math.max(floorAt(nx, nz) + 0.25, ny));
      f.position[o] = nx;
      f.position[o + 1] = ny;
      f.position[o + 2] = nz;
      // The tail beats as fast as the fish is going: a body length and a half a stroke, never quite still, so a fish
      // hanging in the water only fans gently and one dashing off thrashes. Effort eases, so strokes never jerk.
      const size = f.size[i];
      const lengths = speed / size;
      const want = Math.min(1, 0.15 + lengths / 2.5);
      f.effort[i] += (want - f.effort[i]) * (1 - Math.exp(-delta * 3));
      f.beat[i] = (f.beat[i] + delta * Math.PI * 2 * Math.min(8, 0.6 + lengths * 0.9)) % (Math.PI * 200);
      const was0 = f.heading[o];
      const was2 = f.heading[o + 2];
      // Turn toward where it is going, gently, and stay level.
      if (speed > 0.02) {
        const h = 1 - Math.exp(-delta * 5);
        let hx = f.heading[o] + (vx / speed - f.heading[o]) * h;
        let hy = f.heading[o + 1] + ((vy / speed) * 0.5 - f.heading[o + 1]) * h;
        let hz = f.heading[o + 2] + (vz / speed - f.heading[o + 2]) * h;
        const l = Math.hypot(hx, hy, hz) || 1;
        hx /= l;
        hy /= l;
        hz /= l;
        f.heading[o] = hx;
        f.heading[o + 1] = hy;
        f.heading[o + 2] = hz;
      }
      // Curled into the turn by how fast it is turning.
      const yaw = (was2 * f.heading[o] - was0 * f.heading[o + 2]) / delta;
      const curl = Math.max(-0.5, Math.min(0.5, yaw * 0.12));
      f.curve[i] += (curl - f.curve[i]) * (1 - Math.exp(-delta * 6));
    }
  }
}

export function Fishes({ schools, active, seed }: { schools: School[]; active: boolean; seed: number }) {
  // Full detail for the big fish; the small and the far, a few pixels long, are drawn with fewer rings.
  const shapes = useMemo(() => ({ fish: fishShape(12, 8), shark: sharkShape(14, 8), small: fishShape(8, 6), tiny: fishShape(6, 5), far: sharkShape(10, 6) }), []);
  const built = useMemo(
    () =>
      schools.map((school, n) => {
        // The first school of sardines comes by the eye's start.
        const shoal = new Shoal(school, seed * 31 + n * 977 + 5, n === schools.findIndex((s) => s.kind === "sardine"));
        const kind = shoal.fish.kind;
        const far = !!kind.centre;
        const small = kind.size[1] < 0.45 || far;
        // The far ones, a few pixels long, coarse; small fish near enough to come by the eye, finer.
        const shape = kind.shape === "shark" ? (far ? shapes.far : shapes.shark) : far ? shapes.tiny : small ? shapes.small : shapes.fish;
        const shark = kind.shape === "shark";
        const geometry = new THREE.InstancedBufferGeometry();
        for (const name of ["position", "normal", "aFin"]) geometry.setAttribute(name, shape.getAttribute(name));
        geometry.setIndex(shape.getIndex());
        // Rewritten whole every frame and sent once: left at the usual usage, as three's WebGPU backend sends an attribute
        // marked dynamic again for every pass it is drawn in, whether or not it has changed since.
        const at = new THREE.InstancedBufferAttribute(new Float32Array(school.count * 4), 4);
        const facing = new THREE.InstancedBufferAttribute(new Float32Array(school.count * 4), 4);
        const swim = new THREE.InstancedBufferAttribute(new Float32Array(school.count * 4), 4);
        geometry.setAttribute("aAt", at);
        geometry.setAttribute("aFacing", facing);
        geometry.setAttribute("aSwim", swim);
        geometry.instanceCount = school.count;
        for (let i = 0; i < school.count; i++) facing.array[i * 4 + 3] = Math.random() * 100;

        const A = attribute("aAt", "vec4") as any;
        const H = attribute("aFacing", "vec4") as any;
        // Swims by a wave running down the body to the tail, as hard and as fast as the fish is going (the beat's phase
        // and strength come from the processor), and curls into its turns.
        const fin = attribute("aFin", "float") as any;
        const S = attribute("aSwim", "vec4") as any;
        const posed = (p: any, n: any) => {
          // How far back along the body, 0 at the snout and 1 at the root of the tail, and on into the tail fin.
          const back = float(0.5).sub(p.x).div(0.86).clamp(0, 1.25) as any;
          // The wave runs back down the body about a body length long, barely moving the head, swelling sharply toward the
          // tail, which sways about a tenth of a length each way at full effort; the tail fin follows the bend on through.
          const envelope = back.mul(back).mul(0.85).add(back.mul(0.1)).add(0.05) as any;
          const beat = sin(S.x.sub(back.mul(5.6))) as any;
          const bend = beat.mul(envelope).mul(S.y.mul(0.11)).add(S.z.mul(p.x.sub(0.1).mul(p.x.sub(0.1)))) as any;
          // The paired fins row in and out from the flanks, hardest when the fish hangs still and holds its place by them.
          const row = float(1.15).sub(S.y) as any;
          const out = fin.mul(smoothstep(0.02, 0.05, abs(p.z))).mul(sin(sea.clock.mul(3.1).add(H.w.mul(2))).mul(row).mul(shark ? 0.08 : 0.35)) as any;
          const local = vec3(p.x, p.y.mul(kind.deep), p.z.mul(out.add(1)).add(bend)) as any;
          const f = normalize(H.xyz.add(vec3(1e-4, 0, 0))) as any;
          const level = normalize(vec3(f.z.negate(), 0, f.x).add(vec3(0, 0, 1e-4))) as any;
          // Leaning a little into its turns.
          const roll = S.z.mul(-0.9).clamp(-0.35, 0.35) as any;
          const flat = level.cross(f) as any;
          const side = level.mul(cos(roll)).add(flat.mul(sin(roll))) as any;
          const up = side.cross(f) as any;
          const turned = f.mul(local.x).add(up.mul(local.y)).add(side.mul(local.z)) as any;
          const nl = vec3(n.x, n.y.div(kind.deep), n.z) as any;
          return { position: A.xyz.add(turned.mul(A.w)), normal: normalize(f.mul(nl.x).add(up.mul(nl.y)).add(side.mul(nl.z))) };
        };
        const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.35 + (1 - kind.shine) * 0.4, metalness: 0, side: THREE.DoubleSide });
        const swum = posed(positionGeometry, attribute("normal", "vec3"));
        material.positionNode = swum.position;
        const normal = varying(swum.normal) as any;
        material.normalNode = transformNormalToView(normal) as any;
        const local = varying(positionGeometry) as any;
        const finned = varying(fin) as any;
        // An eye, dark with a pale ring, and the curve of the gill cover behind it, darker; a shark's slits instead.
        const eyeAt = shark ? vec3(0.42, 0.014, 0) : vec3(0.405, 0.024, 0);
        const eyeSize = shark ? 0.008 : 0.015;
        const fromEye = local.xy.sub(eyeAt.xy).length() as any;
        const side = smoothstep(0.004, 0.012, abs(local.z)).mul(finned.oneMinus()) as any;
        const pupil = smoothstep(eyeSize * 0.62, eyeSize * 0.5, fromEye).mul(side) as any;
        const ring = smoothstep(eyeSize, eyeSize * 0.85, fromEye).mul(side).sub(pupil).max(0) as any;
        const gill = shark
          ? smoothstep(0.003, 0.0015, abs(local.x.sub(0.3).mod(0.016).sub(0.008))).mul(smoothstep(0.34, 0.33, local.x)).mul(smoothstep(0.25, 0.26, local.x)).mul(smoothstep(0.03, 0.02, abs(local.y)))
          : smoothstep(0.004, 0.0015, abs(local.x.sub(float(0.335).sub(local.y.mul(local.y).mul(6))))).mul(smoothstep(0.075, 0.05, abs(local.y)));
        // Scales on a bony fish: rows of them, each row set half a scale over, each scale's rounded edge lying back
        // toward the tail, a little darker, and its face catching the light. Only drawn where a fish is big enough on
        // screen for them to show, so far ones never shimmer.
        const scaled = shark
          ? float(1)
          : (() => {
              const sy = local.y.mul(52) as any;
              const row = sy.floor() as any;
              const sx = local.x.mul(44).add(row.mod(2).mul(0.5)) as any;
              const cell = vec3(sx.fract(), sy.fract(), 0) as any;
              const d = cell.xy.sub(vec3(1, 0.5, 0).xy).mul(vec3(1, 1.15, 0).xy).length() as any;
              const edge = smoothstep(0.78, 0.92, d).mul(smoothstep(1.05, 0.95, d)) as any;
              const face = smoothstep(0.95, 0.2, d).mul(0.08) as any;
              const close = smoothstep(9, 3, positionWorld.sub(cameraPosition).length().div(A.w)).mul(finned.oneMinus()).mul(smoothstep(0.42, 0.36, local.x)) as any;
              return float(1).add(face.sub(edge.mul(0.22)).mul(close));
            })();
        const skin = kind.tone(local.x, local.y, local.z, H.w.fract()).mul(scaled) as any;
        // Fins paler and a little see-through at their edges.
        const body = mix(skin, skin.mul(0.8).add(0.04), finned.mul(0.6)) as any;
        const tone = mix(mix(body.mul((gill as any).mul(-0.35).add(1)), color("#d8d0b0").mul(skin.add(0.3)), ring.mul(0.6)), color("#050505"), pupil) as any;
        material.colorNode = tone;
        // Silver sides flash as a fish turns its flank to the light.
        const V = normalize(cameraPosition.sub(positionWorld)) as any;
        const flash = pow(max(normal.dot(normalize(V.add(sea.toSun))), 0), 12).mul(kind.shine).mul(sea.power).mul(0.4) as any;
        underSea(material, tone, { normal, caustics: false, through: tone.mul(finned).mul(0.08), extra: sea.sun.mul(flash).add(haze(normal).mul(kind.shine * 0.25)) });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        return { shoal, mesh, at, facing, swim };
      }),
    [schools, shapes, seed]
  );
  useDispose(shapes.fish, shapes.shark, shapes.small, shapes.tiny, shapes.far, ...built.flatMap((b) => [b.mesh.geometry, b.mesh.material as THREE.Material]));

  useFrame((_, raw) => {
    if (!active) return;
    const delta = Math.min(raw, 1 / 20);
    const live = scenePhase.current === "live";
    for (const { shoal, at, facing, swim } of built) {
      if (live) shoal.seen += delta;
      shoal.step(delta, stirs);
      const f = shoal.fish;
      const a = at.array as Float32Array;
      const h = facing.array as Float32Array;
      const w = swim.array as Float32Array;
      for (let i = 0; i < f.count; i++) {
        w[i * 4] = f.beat[i];
        w[i * 4 + 1] = f.effort[i];
        w[i * 4 + 2] = f.curve[i];
        a[i * 4] = f.position[i * 3];
        a[i * 4 + 1] = f.position[i * 3 + 1];
        a[i * 4 + 2] = f.position[i * 3 + 2];
        a[i * 4 + 3] = f.size[i];
        h[i * 4] = f.heading[i * 3];
        h[i * 4 + 1] = f.heading[i * 3 + 1];
        h[i * 4 + 2] = f.heading[i * 3 + 2];
      }
      at.needsUpdate = true;
      facing.needsUpdate = true;
      swim.needsUpdate = true;
    }
  });

  return (
    <>
      {built.map((b, i) => (
        <primitive key={i} object={b.mesh} />
      ))}
    </>
  );
}

// Jellyfish drifting in the water column: a pulsing bell, glowing faintly at its rim, trailing fine tentacles.
export function Jellies({ count }: { count: number }) {
  const { mesh, material } = useMemo(() => {
    const random = lehmer(6061);
    const bell = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
    const strands: THREE.BufferGeometry[] = [bell];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pts: number[] = [];
      const segs = 12;
      const r = 0.85;
      for (let s = 0; s < segs; s++) {
        const y0 = -(s / segs) * 3.2;
        const y1 = -((s + 1) / segs) * 3.2;
        const w = 0.03;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        pts.push(x - w, y0, z, x + w, y0, z, x + w, y1, z, x - w, y0, z, x + w, y1, z, x - w, y1, z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.computeVertexNormals();
      strands.push(g);
    }
    const shape = merge(strands);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", shape.getAttribute("position"));
    geometry.setAttribute("normal", shape.getAttribute("normal"));
    const at: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = 1.5 + random() * 10;
      at.push(Math.cos(a) * r, 2.5 + random() * 4.5, Math.sin(a) * r - 1, 0.07 + random() * 0.12);
    }
    geometry.setAttribute("aAt", new THREE.InstancedBufferAttribute(new Float32Array(at), 4));
    geometry.instanceCount = count;
    shape.dispose();
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const A = attribute("aAt", "vec4") as any;
    const p = positionGeometry as any;
    const t = sea.clock as any;
    const seed = A.x.mul(13.1).add(A.z.mul(7.7)) as any;
    const pulse = sin(t.mul(1.6).add(seed)) as any;
    const isBell = p.y.greaterThan(-0.01).select(1, 0) as any;
    // The bell squeezes and opens; the tentacles trail and wave below.
    const squeeze = float(1).sub(pulse.mul(0.12).mul(isBell)) as any;
    const trail = p.y.negate().max(0) as any;
    const wave = (vec3 as any)((sin as any)(t.mul(0.9).add(seed).add(trail.mul(1.6))).mul(trail).mul(0.12), 0, (cos as any)(t.mul(0.7).add(seed).add(trail.mul(1.3))).mul(trail).mul(0.12)) as any;
    const local = vec3(p.x.mul(squeeze), p.y.mul(isBell.mul(pulse.mul(0.15).add(0.85)).add(isBell.oneMinus())), p.z.mul(squeeze)).add(wave) as any;
    const drift = vec3(sin(t.mul(0.05).add(seed)).mul(1.5), sin(t.mul(0.08).add(seed.mul(1.3))).mul(0.8), cos(t.mul(0.04).add(seed)).mul(1.5)) as any;
    const centre = A.xyz.add(drift) as any;
    material.positionNode = centre.add(local.mul(A.w)) as any;
    const shell = varying(p) as any;
    material.colorNode = Fn(() => {
      const rim = smoothstep(0.3, 0.05, shell.y).mul(isBell) as any;
      const body = isBell.mul(0.25).add(rim.mul(0.9)).add(isBell.oneMinus().mul(0.35)) as any;
      const tint = mix(color("#ff9ad8"), color("#8ad8ff"), (mx_noise_float(centre.mul(0.3)) as any).mul(0.5).add(0.5)) as any;
      const d = positionWorld.sub(cameraPosition).length() as any;
      const lit = sea.shallow.mul(0.4).add(sea.sun.mul(sea.power).mul(0.1)).add(tint.mul(sea.glow.mul(0.6).add(0.1))).add(tint.mul(stirred(centre).mul(4))) as any;
      return vec4(lit.mul(body).mul(through(d)).mul(0.6), 1);
    })() as any;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return { mesh, material };
  }, [count]);
  useDispose(mesh.geometry, material);
  return <primitive object={mesh} />;
}

