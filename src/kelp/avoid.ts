import { NODES, type Forest } from "./kelp";
import { SURFACE } from "./water";

// Where the giant kelp stands, for fish to swim round it: for each plant, at each of a few heights, the middle of its
// stipes there and how far they spread from it. Worked out each frame from the stipes as they sway.

export const BANDS = 8;
const BAND = SURFACE / BANDS;

export const kelpColumns: { plants: number; data: Float32Array } = { plants: 0, data: new Float32Array(0) };

export const bandOf = (y: number) => Math.max(0, Math.min(BANDS - 1, Math.floor(y / BAND)));

// x, z of the middle, the spread, and how many points were found, per plant per band.
export function fillColumns(forest: Forest, data: Float32Array) {
  const p = forest.chains.shown;
  data.fill(0);
  forest.stipes.forEach((stipe, i) => {
    for (let k = 1; k < NODES; k++) {
      const o = (i * NODES + k) * 3;
      const at = (stipe.plant * BANDS + bandOf(p[o + 1])) * 4;
      data[at] += p[o];
      data[at + 1] += p[o + 2];
      data[at + 3] += 1;
    }
  });
  for (let at = 0; at < data.length; at += 4) {
    const n = data[at + 3];
    if (n > 0) {
      data[at] /= n;
      data[at + 1] /= n;
    } else data[at + 2] = -1;
  }
  forest.stipes.forEach((stipe, i) => {
    for (let k = 1; k < NODES; k++) {
      const o = (i * NODES + k) * 3;
      const at = (stipe.plant * BANDS + bandOf(p[o + 1])) * 4;
      const d = Math.hypot(p[o] - data[at], p[o + 2] - data[at + 1]);
      if (d > data[at + 2]) data[at + 2] = Math.min(d, 1.6);
    }
  });
  kelpColumns.plants = forest.plants.length;
  kelpColumns.data = data;
}
