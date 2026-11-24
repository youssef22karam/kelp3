import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { lookUniforms } from "./Stage";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// Lightweight single-pass presentation: no full-screen DoF blur, multi-pass bloom, or second overlay render target.
// Everything (including light shafts and plankton) renders directly in the main pass with hardware depth testing for 60 FPS.

export const OVERLAY_LAYER = 0;
export const focusDistance = uniform(4);
export const focusBlur = uniform(1.5);

type DepthNode = { sample: (uv: any) => any };
type Listener = (depth: DepthNode) => void;

export const overlayLink = {
  listen(_listener: Listener) {
    return () => {};
  }
};

export function Post({ range: _range = 5 }: { range?: number }) {
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer;
  useFrame(() => {
    gl.toneMappingExposure = lookUniforms.exposure.value;
  });
  return null;
}
