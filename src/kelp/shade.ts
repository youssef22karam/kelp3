import * as THREE from "three/webgpu";
import { cameraPosition, max, normalWorld, normalize, output, positionWorld, pow, varying, vec3, vec4 } from "three/tsl";
import { caustics, sea, underwater } from "./water";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Everything solid under the water is finished the same way: caustics laid over its own colour, light through it if it is
// thin, and then the water between it and the eye. Caustics can be worked out at the corners and blended across, for
// small, finely divided, moving things where the difference never shows and the saving does.
export function underSea(material: THREE.MeshStandardNodeMaterial, albedo: any, options: { normal?: any; through?: any; extra?: any; caustics?: boolean | "vertex" } = {}) {
  const N = options.normal ?? normalWorld;
  const light = options.caustics === "vertex" ? varying(caustics(positionWorld, N)) : caustics(positionWorld, N);
  let glow: any = options.caustics === false ? vec3(0, 0, 0) : (albedo as any).mul(light).mul(2.2);
  if (options.through) {
    // Thin things glow when the eye looks up through them toward the sun.
    const V = normalize(cameraPosition.sub(positionWorld)) as any;
    const into = pow(max(V.negate().dot(sea.toSun), 0), 2.5) as any;
    glow = glow.add((options.through as any).mul(sea.sun).mul(sea.power).mul(into.mul(0.85).add(0.06)));
  }
  if (options.extra) glow = glow.add(options.extra);
  material.emissiveNode = glow;
  material.outputNode = vec4(underwater((output as any).rgb, positionWorld), 1) as any;
  return material;
}
