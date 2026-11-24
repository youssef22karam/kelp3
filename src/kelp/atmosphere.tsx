import { useMemo } from "react";
import * as THREE from "three/webgpu";
import { attribute, cameraPosition, cross, float, fract, max, min, mix, normalize, positionGeometry, pow, sin, smoothstep, uv, vec3, vec4 } from "three/tsl";
import { useDispose } from "./engine/dispose";
import { focusDistance } from "./engine/Post";
import { lehmer } from "./engine/random";
import { SURFACE, sea, through } from "./water";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Plankton bokeh and rising marine snow, rendered directly in the main pass with hardware depth testing
// (zero extra render target or depth readback).
export function Atmosphere({ motes, rising = false, far = false }: { motes: number; rising?: boolean; far?: boolean }) {
  const NEAR = far ? 16 : rising ? 7 : 4;
  const parts = useMemo(() => {
    const random = lehmer(far ? 7027 : rising ? 6113 : 4471);
    const seeds = new Float32Array(motes * 4);
    for (let i = 0; i < motes; i++) seeds.set([random(), random(), random(), random()], i * 4);
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });

    const t = sea.clock as any;
    const s = attribute("aSeed", "vec4") as any;
    const carried = sea.carried as any;
    const climb = rising ? t.mul(0.035).mul(s.w.add(0.5)) : t.mul(-0.02).mul(s.w.add(0.5));
    const drift = vec3(sin(t.mul(0.11).add(s.w.mul(40))).mul(0.25).add(carried.x), climb, sin(t.mul(0.09).add(s.x.mul(31))).mul(0.25).add(carried.y)) as any;
    const centre = cameraPosition.add(fract(s.xyz.add(drift.sub(cameraPosition).div(NEAR))).sub(0.5).mul(NEAR)) as any;
    const toEye = normalize(cameraPosition.sub(centre)) as any;
    const right = normalize(cross(vec3(0, 1, 0), toEye)) as any;
    const up = cross(toEye, right) as any;
    const away = cameraPosition.sub(centre).length() as any;

    const sharp = max(float(rising ? 0.001 : 0.0016), away.mul(rising ? 0.0009 : 0.0014)).mul(s.w.mul(1.4).add(0.6)) as any;
    const blur = min(away.sub(focusDistance).abs().div(away).mul(rising ? 0.01 : 0.026), away.mul(s.y.mul(s.y).mul(rising ? 0.005 : 0.014).add(rising ? 0.002 : 0.004))) as any;
    const radius = sharp.add(blur) as any;
    const spread = sharp.div(radius).pow(1.15).max(0.24) as any;
    const soft = smoothstep(0.002, 0.012, blur) as any;
    material.positionNode = centre.add(right.mul(positionGeometry.x.mul(radius.mul(2)))).add(up.mul(positionGeometry.y.mul(radius.mul(2)))) as any;

    const r = uv().sub(0.5).length() as any;
    const point = float(1).sub(smoothstep(0.1, 0.5, r)) as any;
    const disc = float(1).sub(smoothstep(0.36, 0.5, r)).mul(0.8).add(smoothstep(0.3, 0.44, r).mul(float(1).sub(smoothstep(0.44, 0.5, r))).mul(0.1)) as any;
    const dot = mix(point, disc, soft).mul(spread).mul(s.z.mul(s.z).mul(0.65).add(0.35)) as any;
    const fade = smoothstep(far ? 2.5 : 0.15, far ? 4 : 0.4, away).mul(float(1).sub(smoothstep(NEAR * 0.36, NEAR * 0.5, away))) as any;
    const twinkle = sin(t.mul(s.y.mul(1.2).add(0.3)).add(s.z.mul(50))).mul(0.25).add(0.75) as any;
    const onward = pow(max(toEye.negate().dot(sea.toSun), 0), 3) as any;
    const lit = through(max(float(SURFACE).sub(centre.y), 0).mul(0.55)) as any;
    const glow = (sea.sun as any).mul(sea.power).mul(onward.mul(0.9).add(0.1)).add((sea.shallow as any).mul(0.7)) as any;
    const snowGlow = glow.mul(through(away.mul(1.5))) as any;
    material.colorNode = vec4((rising ? snowGlow : glow).mul(lit).mul(dot).mul(fade).mul(twinkle).mul(1.35), 1) as any;

    const specks = new THREE.InstancedMesh(quad, material, motes);
    const identity = new THREE.Matrix4();
    for (let i = 0; i < motes; i++) specks.setMatrixAt(i, identity);
    specks.frustumCulled = false;
    specks.renderOrder = 6;
    return { quad, material, specks };
  }, [motes, rising, far, NEAR]);
  useDispose(parts.quad, parts.material);

  return <primitive object={parts.specks} />;
}
