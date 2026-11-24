
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { Fn, attribute, cameraFar, cameraNear, cameraPosition, color, cos, cross, dot, exp, float, length, max, mix, mod, normalize, perspectiveDepthToViewZ, positionGeometry, positionView, positionWorld, pow, reflect, screenUV, sin, smoothstep, uniform, varying, vec2, vec3, vec4 } from "three/tsl";
import { useDispose } from "./engine/dispose";
import { lehmer } from "./engine/random";
import { OVERLAY_LAYER, overlayLink } from "./engine/Post";
import { SURFACE, SWELL, environment, haze, sea, stirred, threads, through } from "./water";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// The water round everything: the far haze behind, the underside of the surface overhead, shafts of light down from it
// and the specks drifting in it.

export function Backdrop() {
  const { mesh, material } = useMemo(() => {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: true });
    material.colorNode = environment(positionWorld.sub(cameraPosition)) as any;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 14), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    return { mesh, material };
  }, []);
  useDispose(mesh.geometry, material);
  // Always round the eye.
  useFrame(({ camera }) => mesh.position.copy(camera.position));
  return <primitive object={mesh} />;
}

// The surface's waves: the swell that sways the forest, crossing chop on it, and fine ripples that fade with distance
// before they could shimmer. Height for the mesh, slope for the shading.
const CHOP: [number, number, number, number, number][] = [
  // direction x, z, wavenumber, speed, height
  [0.6, -0.8, 0.9, 1.1, 0.07],
  [-0.3, 1, 1.7, 1.6, 0.045],
  [0.9, 0.45, 3.3, 2.3, 0.024],
  [-0.75, 0.6, 6.2, 3.3, 0.013]
];
const WAVE_SCALE = 2;
const waves = (xz: any, fine: any) => {
  const t = sea.clock as any;
  const phase = xz.x.mul(SWELL.x).add(xz.y.mul(SWELL.y)).mul(sea.waveK).sub(sea.surge) as any;
  const tall = sea.swell.mul(0.12) as any;
  let h: any = cos(phase).mul(tall);
  let g: any = vec2(SWELL.x, SWELL.y).mul(sin(phase).mul(tall).mul(sea.waveK).negate());
  CHOP.forEach(([dx, dz, k0, w0, a0], i) => {
    // Drawn at twice the size: twice as long, as much taller, and slower as longer waves are.
    const k = k0 / WAVE_SCALE;
    const w = w0 / Math.sqrt(WAVE_SCALE);
    const a = a0 * WAVE_SCALE;
    const d = vec2(dx, dz).normalize() as any;
    const p = xz.dot(d).mul(k).sub(t.mul(w)).add(i * 1.7) as any;
    // The finer, the more it fades with distance.
    const keep = i < 3 ? float(1) : fine;
    const amp = sea.swell.mul(0.5).add(0.6).mul(a).mul(keep) as any;
    h = h.add(sin(p).mul(amp));
    g = g.add(d.mul(cos(p).mul(amp).mul(k)));
  });
  return { h, g };
};

// The underside of the surface: the sky shows through a bright window overhead, the sun glittering in it, and
// everywhere else the surface is a mirror of the dark water below, the line between them broken by the waves.
export function Surface({ fine }: { fine: number }) {
  const { mesh, material } = useMemo(() => {
    const rings = Math.max(24, Math.round(36 * fine));
    const spokes = Math.max(40, Math.round(64 * fine));
    const points: number[] = [0, 0, 0];
    const index: number[] = [];
    for (let r = 1; r <= rings; r++) {
      const radius = 110 * Math.pow(r / rings, 2.4);
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * Math.PI * 2;
        points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      }
    }
    for (let s = 0; s < spokes; s++) index.push(0, 1 + s, 1 + ((s + 1) % spokes));
    for (let r = 1; r < rings; r++)
      for (let s = 0; s < spokes; s++) {
        const a = 1 + (r - 1) * spokes + s;
        const b = 1 + (r - 1) * spokes + ((s + 1) % spokes);
        index.push(a, a + spokes, b, b, a + spokes, b + spokes);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    // The mesh follows the eye across; heights are worked out where each point is in the world.
    const placed = () => {
      const world = (positionGeometry as any).add(vec3(eyeAt.x, 0, eyeAt.z)) as any;
      return world;
    };
    const world = placed();
    // Out where the rings are metres apart they cannot follow the waves, and raising them would tilt whole flat
    // triangles, their straight edges showing in the light; there the surface lies flat and only its shading has waves.
    const reach = float(1).sub(smoothstep(14, 40, length((positionGeometry as any).xz))) as any;
    material.positionNode = vec3(world.x, waves(world.xz, float(0)).h.mul(reach).add(SURFACE), world.z) as any;
    material.colorNode = Fn(() => {
      const P = positionWorld as any;
      const toP = P.sub(cameraPosition) as any;
      const d = length(toP) as any;
      const fineDetail = smoothstep(30, 5, d) as any;
      // The waves' slopes, steepened for the shading: seen from below every ripple bends the sky about, and that is how
      // the waves show.
      // Less so further off, where steep slopes would flip whole patches between window and mirror with a hard edge.
      const g = waves(P.xz, fineDetail).g.mul(mix(float(0.8), float(1.7), fineDetail)) as any;
      const N = normalize(vec3(g.x.negate(), 1, g.y.negate())) as any;
      const V = toP.div(d) as any;
      const cosI = max(dot(V, N), 0) as any;
      // Light from the air bends in only within about 48.6° of straight up; beyond that the surface reflects.
      const sinT2 = float(1.333 * 1.333).mul(float(1).sub(cosI.mul(cosI))) as any;
      // A wide blend between the window and the mirror, so a wave's trough never cuts a dark shape out of the light.
      const window = smoothstep(1.0, 0.5, sinT2) as any;
      // The way out through the surface into the air, bent at it: the sky seen that way is pale low down and deeper
      // blue overhead, so each wave's slope shows as a patch lighter or darker, and the sun as a broken glitter.
      const cosT = float(1).sub(sinT2).max(0).sqrt() as any;
      const out = normalize(V.mul(1.333).add(N.mul(cosT.sub(cosI.mul(1.333))))) as any;
      const high = max(out.y, 0) as any;
      const air = mix(vec3(1.25, 1.3, 1.3), vec3(0.55, 0.8, 1.05), pow(high, 0.6)) as any;
      const outward = max(dot(out, sea.toSunAir), 0) as any;
      const sunAbove = pow(outward, 900).mul(40).add(pow(outward, 140).mul(5)).add(pow(outward, 10).mul(0.5)) as any;
      // Less gets through toward the window's edge, where the surface turns to a mirror.
      const passes = float(1).sub(pow(float(1).sub(cosT), 5)) as any;
      // Through the window the light is also gathered and spread by the waves into a moving net.
      const net = threads(P.xz.div(3.2 * WAVE_SCALE).add(g.mul(0.4)), sea.clock.mul(0.42 / Math.sqrt(WAVE_SCALE)).mul(sea.flicker).add(23)) as any;
      const sky = sea.shallow.mul(air).mul(net.mul(0.45).add(0.85)).mul(passes).add(sea.sun.mul(sea.power).mul(sunAbove.add(net.mul(0.08)).add(0.05))) as any;
      // Outside the window the surface is a rippling mirror of the lit water below, not a dark lid: the water's own
      // colour, lighter on the faces of the waves that catch the light from below and darker in their troughs.
      const mirrored = haze(reflect(V, N.negate())) as any;
      const facing = dot(N, sea.toSun).mul(2).add(0.2).clamp(0.4, 1.4) as any;
      const below = mix(mirrored, sea.shallow.mul(0.85), 0.5).mul(net.mul(0.3).add(0.8)).mul(facing.mul(0.5).add(0.5)) as any;
      const rim = smoothstep(0.75, 0.98, sinT2).mul(window).mul(0.6) as any;
      // The sun seen through the water, a glow round it wherever the eye turns toward it.
      const toward = max(V.dot(sea.toSun), 0) as any;
      const glow = sea.sun.mul(sea.power).mul(pow(toward, 12).mul(0.08).add(pow(toward, 80).mul(0.35)).add(pow(toward, 900).mul(5))) as any;
      const rgb = mix(below, sky, window).add(sea.shallow.mul(rim)).add(glow) as any;
      // Far off, seen nearly edge-on, the surface gives way to the water itself, so there is no line where it ends.
      const kept = through(d).mul(smoothstep(0.03, 0.22, V.y)) as any;
      return vec4(rgb.mul(kept).add(haze(toP).mul(vec3(1, 1, 1).sub(kept))), 1);
    })() as any;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return { mesh, material };
  }, [fine]);
  useDispose(mesh.geometry, material);
  useFrame(({ camera }) => eyeAt.value.set(Math.round(camera.position.x * 2) / 2, 0, Math.round(camera.position.z * 2) / 2));
  return <primitive object={mesh} />;
}
const eyeAt = uniform(new THREE.Vector3()) as any;

// Shafts of sunlight down from the surface into the deep: long, all running the way the sun comes in, so that seen from
// below they draw together toward one point far down, as they do in open water. Each is one strip turned about its own
// line to face the eye, so it reads as a soft column from any side with no plane ever seen edge-on, and fades in at the
// surface and out toward its far end so no end shows. Each brightens and fades as
// the waves overhead gather the light and let it go. Laid out on the graphics card from the sun's direction, so they
// swing round with it as the dial turns.
export function Shafts({ count, long, spread }: { count: number; long: number; spread: number }) {
  const { mesh, material } = useMemo(() => {
    const random = lehmer(5521);
    const LONG = long;
    const top: number[] = [];
    const shaft: number[] = [];
    const index: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * spread;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r + 2;
      const wide = 0.3 + random() ** 2 * 1.3;
      const seed = random() * 100;
      {
        const base = top.length / 4;
        // Down the shaft in steps, so it can widen as it goes.
        const steps = 6;
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          for (const across of [-1, 1]) {
            top.push(x, z, wide, 0);
            shaft.push(across, u * LONG, seed, 0);
          }
          if (k < steps) {
            const q = base + k * 2;
            index.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
          }
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((top.length / 4) * 3), 3));
    geometry.setAttribute("aTop", new THREE.Float32BufferAttribute(top, 4));
    geometry.setAttribute("aShaft", new THREE.Float32BufferAttribute(shaft, 4));
    geometry.setIndex(index);
    // Light added to what is behind, its colour only: additive blending would also pile up alpha over every strip's
    // whole area, and where strips overlap the passes after would darken it into hard-edged wedges.
    // Drawn in the overlay pass, added over the finished frame, not in the scene's own pass: there, light laid over
    // everything would also be laid into the buffers the passes after read (normals, motion), and they would turn it
    // into hard-edged shapes. What hides a shaft is worked out from the scene's depth instead (below).
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    // The way the light runs under water, and two ways square to it to lay each plane out across it, turned about it.
    const A = attribute("aShaft", "vec4") as any;
    const T = attribute("aTop", "vec4") as any;
    const downward = (sea.toSun as any).negate() as any;
    const width = T.z.mul(A.y.div(LONG).mul(1.5).add(1)) as any;
    // Each shaft drifts a little as the waves overhead move, and its light comes and goes with the same moving net of
    // threads that lays the caustics on the floor, read where it meets the surface.
    const t0 = sea.clock as any;
    const sway = vec3(sin(t0.mul(0.23).add(A.z)), 0, cos(t0.mul(0.17).add(A.z.mul(1.3)))).mul(float(0.45).sub(A.y.div(LONG).mul(0.3))) as any;
    // Starting a metre down, under the deepest trough, so the waves never cut across a lit part of the shaft.
    const top0 = vec3(T.x, SURFACE - 1, T.y).add(sway) as any;
    // Turned about its own line to face the eye, as one flat piece: aimed from its middle, so it never twists along its
    // length and folds over itself when the eye is close.
    const onLine = top0.add(downward.mul(A.y)) as any;
    const middle = top0.add(downward.mul(LONG / 2)) as any;
    const side = normalize(cross(downward, (cameraPosition as any).sub(middle))) as any;
    material.positionNode = onLine.add(side.mul(A.x.mul(width))) as any;
    const S = varying(A) as any;
    const face = varying(normalize(cross(side, downward))) as any;
    // How much light the waves are gathering into the shaft just now: the same for the whole shaft, so worked out once
    // per corner rather than at every point of it.
    const net = threads(top0.xz.div(sea.cell.mul(4)), t0.mul(0.42).mul(sea.flicker).add(23)) as any;
    const gathered = varying(sin(t0.mul(0.31).add(A.z)).mul(sin(t0.mul(0.19).add(A.z.mul(1.7)))).mul(0.3).add(0.4).add(smoothstep(0.02, 0.3, net).mul(0.9))) as any;
    material.colorNode = Fn(() => {
      const P = positionWorld as any;
      const across = S.x as any;
      const depth = S.y as any;
      // Soft right across, no edge to it: a bell that has fallen to nothing well before the plane ends.
      // (Edges low to high throughout: smoothstep with them reversed is undefined on some GPUs.)
      const soft = exp(across.mul(across).mul(-4.5)).sub(0.011).max(0) as any;
      // Strong near the top, fading slowly down into the blue, and coming in softly from the surface so no plane's end shows.
      const fall = float(1).div(depth.mul(0.09).add(1)).mul(smoothstep(0, 2.5, depth)).mul(float(1).sub(smoothstep(LONG * 0.55, LONG, depth))) as any;
      const t = sea.clock as any;
      const breathe = gathered;
      const ripple = sin(depth.mul(0.31).sub(t.mul(0.23)).add(S.z.mul(2.3))).mul(0.15).add(0.85) as any;
      const toP = P.sub(cameraPosition) as any;
      const d = length(toP) as any;
      const near = smoothstep(1.5, 6, d) as any;
      // Faced from its middle, a long strip is still seen at a slant toward its ends; nearly edge-on its soft falloff
      // across would squeeze into a hard line, so it fades out as it turns away.
      const facing = smoothstep(0.15, 0.6, normalize(face).dot(toP.div(d)).abs()) as any;
      // Faded out before they reach the floor, so no plane is seen cutting into the sand.
      const above = smoothstep(0.3, 2.6, P.y) as any;
      // And faded out by how far under the surface they are, not just along their line: a strip leans with the sun, so
      // its upper corners reach up into the waves, which would cut them off along a hard line.
      const under = float(1).sub(smoothstep(SURFACE - 3.8, SURFACE - 1.2, P.y)) as any;
      // Looked at along their length, from below or toward the sun, shafts melt into one glow rather than show their sides.
      const along = float(1).sub(smoothstep(0.85, 0.995, toP.div(d).dot(downward).abs())) as any;
      const bright = soft.mul(fall).mul(breathe.mul(breathe).mul(0.8).add(0.2)).mul(ripple).mul(near).mul(facing).mul(above).mul(under).mul(along).mul(sea.shafts).mul(sea.power).mul(0.065) as any;
      // Lit water seen through the water between it and the eye, which turns it blue the further it is.
      return vec4((sea.sun as any).mul(vec3(0.7, 0.92, 1)).mul(bright).mul(through(d.mul(1.4))).max(0), 1);
    })() as any;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return { mesh, material };
  }, [count, long, spread]);
  useDispose(mesh.geometry, material);
  return <primitive object={mesh} />;
}

// What drifts in the water, so it is never quite clear: specks everywhere round the eye in a box that wraps, of three
// kinds. Most are tiny bright motes of plankton and silt, shining brighter where the eye looks through them toward the
// sun, as particles in water scatter light mostly onward; some are flecks of torn weed, green or brown, long and thin,
// tumbling as they go; and a few are soft clumps of detritus. All sink slowly, wander and are carried by the current.
// They write depth, so the blur for focus treats each at its own distance and the near ones stay crisp. In a sea that
// glows they light up blue-green where the water is stirred.
// silt: a second, finer layer through a box twice the size, all of it pale grey silt, so specks at every distance thicken
// into the haze and give the water depth.
export function Snow({ count, silt = false }: { count: number; silt?: boolean }) {
  const camera = useThree((state) => state.camera);
  const eye = useRef(uniform(new THREE.Vector3())).current;
  const { mesh, material } = useMemo(() => {
    const random = lehmer(8803);
    const BOX = silt ? 24 : 12;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const seed: number[] = [];
    for (let i = 0; i < count; i++) seed.push(random() * BOX, random() * BOX, random() * BOX, random());
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(seed), 4));
    geometry.instanceCount = count;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const s = attribute("aSeed", "vec4") as any;
    const t = sea.clock as any;
    // Which kind each is, from its seed: 0 a mote, 1 a fleck of weed, 2 a clump.
    const pick = (silt ? float(0) : s.w.mul(7.31).fract()) as any;
    const fleck = smoothstep(0.6, 0.61, pick).mul(smoothstep(0.89, 0.88, pick)) as any;
    const clump = smoothstep(0.89, 0.9, pick) as any;
    const mote = float(1).sub(fleck).sub(clump) as any;
    // Wandering, sinking slowly (the weed slower), and carried along by the current.
    const carried = sea.carried as any;
    const sink = mix(float(0.025), float(0.012), fleck) as any;
    const drift = vec3(sin(t.mul(0.13).add(s.w.mul(40))).mul(0.4).add(carried.x), t.mul(sink.negate()).add(sin(t.mul(0.2).add(s.w.mul(9))).mul(0.2)), cos(t.mul(0.11).add(s.w.mul(30))).mul(0.4).add(carried.y)) as any;
    const centre = mod(s.xyz.add(drift).sub(eye), BOX).add(eye).sub(BOX / 2) as any;
    const d = length(centre.sub(cameraPosition)) as any;
    // Real sizes: motes a millimetre or three, flecks up to a couple of centimetres, clumps between.
    const k = s.w.mul(13.7).fract() as any;
    const real = mote.mul(k.mul(k).mul(silt ? 0.0045 : 0.0022).add(silt ? 0.0016 : 0.0009)).add(fleck.mul(k.mul(0.008).add(0.004))).add(clump.mul(k.mul(0.004).add(0.003))) as any;
    // Never drawn under about a pixel, so far ones do not flicker; they fade instead, as much as they are smaller.
    const least = d.mul(0.0011) as any;
    const size = max(real, least) as any;
    const cover = varying(real.div(size).pow(2)) as any;
    const toEye = normalize(cameraPosition.sub(centre)) as any;
    const right = normalize(vec3(toEye.z, 0, toEye.x.negate())) as any;
    // Up across the speck as seen, so the quad's face is toward the eye (the other way it is culled).
    const up = normalize(toEye.cross(right)) as any;
    // Flecks long and thin, turning over as they go.
    const spin = t.mul(s.w.mul(1.4).add(0.3)).add(s.w.mul(60)) as any;
    const g = positionGeometry as any;
    const stretch = vec2(mix(float(1), float(2.6), fleck), mix(float(1), float(0.4), fleck)) as any;
    const local = vec2(g.x.mul(stretch.x), g.y.mul(stretch.y)) as any;
    const turned = vec2(local.x.mul(cos(spin)).sub(local.y.mul(sin(spin))), local.x.mul(sin(spin)).add(local.y.mul(cos(spin)))).mul(fleck).add(local.mul(fleck.oneMinus())) as any;
    material.positionNode = centre.add(right.mul(turned.x.mul(size))).add(up.mul(turned.y.mul(size))) as any;
    const kinds = varying(vec3(mote, fleck, clump)) as any;
    const seen = varying(d) as any;
    const onward = varying(pow(max(toEye.negate().dot(sea.toSun), 0), 6)) as any;
    const glow = varying(stirred(centre)) as any;
    const tint = varying(s.w.mul(91.7).fract()) as any;
    const toward = varying(centre.sub(cameraPosition)) as any;
    material.colorNode = Fn(() => {
      const r = positionGeometry.xy.length() as any;
      const a = positionGeometry.y.atan(positionGeometry.x) as any;
      // A clump is ragged at its edge.
      const ragged = r.mul(float(1).add(sin(a.mul(3).add(tint.mul(20))).mul(0.25).mul(kinds.z))) as any;
      const shape = smoothstep(1, 0.55, ragged) as any;
      const fade = smoothstep(0.15, 0.4, seen).mul(smoothstep(BOX / 2, BOX / 2 - 1.5, seen)) as any;
      // Motes shine; weed and detritus are lit like anything else and seen dark against the bright water above.
      const shine = sea.shallow.mul(0.7).add(sea.sun.mul(sea.power).mul(onward.mul(0.5).add(0.12))) as any;
      const weed = mix(color("#5a6a2a"), color("#7a5a2a"), tint) as any;
      const lit = sea.shallow.mul(0.35).add(sea.sun.mul(sea.power).mul(0.08)) as any;
      // Silt: pale grey, lit from above like the rest, a little brighter toward the sun.
      const motes = silt ? color("#cfd3cf").mul(lit.mul(2)).add(sea.sun.mul(sea.power).mul(onward.mul(0.12))) : shine;
      const body = mix(motes, weed.mul(lit), kinds.y).mul(kinds.x.add(kinds.y)).add(color("#8a7a62").mul(lit).mul(kinds.z)) as any;
      const kept = through(seen) as any;
      const rgb = body.mul(kept).add(haze(toward).mul(vec3(1, 1, 1).sub(kept)).mul(kinds.x.oneMinus())) as any;
      const alpha = shape.mul(fade).mul(cover).mul(silt ? float(0.65) : mix(float(0.8), float(0.9), kinds.x.oneMinus())) as any;
      return vec4(rgb.add(color("#5cf2ff").mul(glow.mul(6))), alpha);
    })() as any;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return { mesh, material };
  }, [count, eye, silt]);
  useDispose(mesh.geometry, material);
  useFrame(() => eye.value.copy(camera.position));
  return <primitive object={mesh} />;
}

// The sun as it lights things under water: from its bent direction, its colour dimmed, and a cool fill from the water
// all round, bright above and dark below.
export function Light() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.HemisphereLight>(null);
  useFrame(() => {
    if (sun.current) {
      sun.current.position.copy(sea.toSun.value).multiplyScalar(20);
      sun.current.color.copy(sea.sun.value);
      sun.current.intensity = sea.power.value * 0.9;
    }
    if (fill.current) {
      fill.current.color.copy(sea.shallow.value);
      fill.current.groundColor.copy(sea.deep.value);
      fill.current.intensity = 1.6;
    }
  });
  return (
    <>
      <directionalLight ref={sun} />
      <hemisphereLight ref={fill} />
    </>
  );
}

