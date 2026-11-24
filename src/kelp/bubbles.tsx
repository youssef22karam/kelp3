
import { useMemo } from "react";
import { Fn, attribute, cameraPosition, float, length, max, mod, normalize, positionGeometry, sin, cos, smoothstep, vec2, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { useDispose } from "./engine/dispose";
import { lehmer } from "./engine/random";
import type { Stone } from "./floor";
import { floorAt } from "./kelp";
import { SURFACE, sea, through } from "./water";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Bubbles: threads of them rising from cracks in the rocks, coming in puffs and stopping a while, each bubble wobbling
// as it goes, growing as the water above it thins, carried off by the current and gone at the surface. All of it on the
// graphics card: every bubble's place is worked out from the time, nothing kept or sent each frame. Each writes depth, so
// it stays sharp where it is in focus rather than blurred with the water behind it.

const PER = 45;
// Where the eye starts, and the level way it looks from there.
const START = [0.9, 7.6];
const LOOK = (() => {
  const x = 2.9 - 0.9;
  const z = 1.5 - 7.6;
  const l = Math.hypot(x, z);
  return [x / l, z / l];
})();

export function Bubbles({ stones, fine }: { stones: Stone[]; fine: number }) {
  const { mesh, material } = useMemo(() => {
    const random = lehmer(4409);
    // From the tops of rocks in front of the start, where they are seen.
    const near = stones.filter((s) => s.size > 0.5 && Math.hypot(s.x - 0.5, s.z - 2) < 10 && s.z < 6.5);
    const sources: number[] = [];
    for (let i = 0, n = Math.min(near.length, Math.round(10 * fine)); i < n; i++) {
      const s = near.splice(Math.floor(random() * near.length), 1)[0];
      const a = random() * Math.PI * 2;
      sources.push(s.x + Math.cos(a) * s.size * 0.2, s.y + s.size * 0.6, s.z + Math.sin(a) * s.size * 0.2, random() * 100);
    }
    // More from the floor far off to the left and right of the start view, so they rise at the sides of the picture too.
    const wide = Math.round(6 * fine);
    for (let i = 0; i < wide; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const ahead = 10 + random() * 5;
      const across = side * (6 + random() * 3.5);
      const x = START[0] + LOOK[0] * ahead - LOOK[1] * across;
      const z = START[1] + LOOK[1] * ahead + LOOK[0] * across;
      sources.push(x, floorAt(x, z) + 0.05, z, random() * 100);
    }
    const streams = sources.length / 4;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const from: number[] = [];
    const own: number[] = [];
    for (let i = 0; i < streams; i++)
      for (let j = 0; j < PER; j++) {
        from.push(sources[i * 4], sources[i * 4 + 1], sources[i * 4 + 2], sources[i * 4 + 3]);
        // Size, how fast it rises (the big ones faster), where it is in its rise, and its own wobble.
        const size = 0.008 + random() ** 3 * 0.026;
        own.push(size, 0.24 + size * 7 + random() * 0.04, random() * 100, random() * 100);
      }
    geometry.setAttribute("aFrom", new THREE.InstancedBufferAttribute(new Float32Array(from), 4));
    geometry.setAttribute("aOwn", new THREE.InstancedBufferAttribute(new Float32Array(own), 4));
    geometry.instanceCount = streams * PER;

    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, alphaTest: 0.5 });
    const F = attribute("aFrom", "vec4") as any;
    const O = attribute("aOwn", "vec4") as any;
    const t = sea.clock as any;
    const tall = float(SURFACE).sub(F.y) as any;
    const rise = tall.div(O.y) as any;
    const age = mod(t.add(O.z), rise) as any;
    const up = age.mul(O.y) as any;
    // A stream puffs and rests: a bubble let go while it rests is never drawn.
    const born = t.sub(age) as any;
    const on = smoothstep(-0.25, 0.15, sin(born.mul(0.21).add(F.w)).mul(0.6).add(sin(born.mul(0.83).add(F.w.mul(1.7))).mul(0.4))) as any;
    // Swelling a little as it rises into shallower water, and gone at the surface.
    const size = O.x.mul(up.div(tall).mul(0.5).add(1)).mul(on).mul(smoothstep(tall, tall.sub(0.12), up)).mul(smoothstep(0, 0.05, up)) as any;
    const wobble = O.x.mul(1.6).add(0.01) as any;
    const w = age.mul(O.x.mul(-120).add(8)).add(O.w) as any;
    const centre = vec3(
      F.x.add(sin(w).mul(wobble)).add(sea.drift.x.mul(age)),
      F.y.add(up),
      F.z.add(cos(w.mul(0.8)).mul(wobble)).add(sea.drift.y.mul(age))
    ) as any;
    const toEye = normalize(cameraPosition.sub(centre)) as any;
    const right = normalize(vec3(toEye.z, 0, toEye.x.negate())) as any;
    // Up across the bubble as seen, so the quad's face is toward the eye.
    const upward = normalize(toEye.cross(right)) as any;
    // The bigger ones flatten as they rise, wider than tall.
    const squash = smoothstep(0.02, 0.035, O.x).mul(0.3) as any;
    const g = positionGeometry as any;
    material.positionNode = centre.add(right.mul(g.x.mul(size).mul(squash.add(1)))).add(upward.mul(g.y.mul(size).mul(float(1).sub(squash)))) as any;
    material.colorNode = Fn(() => {
      // A bubble is mostly its silver rim, where light glances off it, with a bright spot from the surface above and
      // a faint one below where the light comes out through it.
      const uv = vec2(g.x, g.y) as any;
      const r = length(uv) as any;
      const disc = smoothstep(1, 0.95, r) as any;
      const rim = smoothstep(0.72, 0.9, r).mul(disc) as any;
      const spot = smoothstep(0.2, 0.06, length(uv.sub(vec2(-0.3, 0.4)))) as any;
      const under = smoothstep(0.3, 0.05, length(uv.sub(vec2(0.15, -0.55)))).mul(0.35) as any;
      const d = length(centre.sub(cameraPosition)) as any;
      const lit = sea.shallow.mul(0.9).add(sea.sun.mul(sea.power).mul(0.22)) as any;
      const shine = rim.mul(0.9).add(spot.mul(1.6)).add(under).add(disc.mul(0.08)) as any;
      // Far ones a speck; near ones not in the eye's face.
      const fade = smoothstep(0.25, 0.7, d) as any;
      return vec4(lit.mul(shine).mul(through(max(d, 0))).mul(fade), 1);
    })() as any;
    // Cut to the round, so each writes depth only where it is and the blur for focus treats it at its own distance.
    material.opacityNode = smoothstep(1, 0.95, vec2(g.x, g.y).length()) as any;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return { mesh, material };
  }, [stones, fine]);
  useDispose(mesh.geometry, material);
  return <primitive object={mesh} />;
}
