import { useEffect } from "react";
import { uniform } from "three/tsl";

// The look of the finished frame, read by the post pipeline.
export type Look = {
  background?: string;
  exposure?: number;
  bloom?: number;
  bloomThreshold?: number;
  vignette?: number;
  grain?: number;
  [key: string]: unknown;
};

export const lookUniforms = {
  exposure: { value: 1.05 },
  bloom: uniform(0.35),
  bloomThreshold: uniform(0.75),
  vignette: uniform(0.55),
  grain: uniform(0.02)
};

export function useLook(look: Look) {
  useEffect(() => {
    if (look.exposure !== undefined) lookUniforms.exposure.value = look.exposure;
    if (look.bloom !== undefined) lookUniforms.bloom.value = look.bloom;
    if (look.bloomThreshold !== undefined) lookUniforms.bloomThreshold.value = look.bloomThreshold;
    if (look.vignette !== undefined) lookUniforms.vignette.value = look.vignette;
    if (look.grain !== undefined) lookUniforms.grain.value = look.grain;
  }, [look]);
}
