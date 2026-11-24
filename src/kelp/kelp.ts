import * as THREE from "three/webgpu";
import { lehmer } from "./engine/random";
import { Chains } from "./chains";
import { SURFACE } from "./water";

// Giant kelp, as it grows: a holdfast gripping the rock, several stipes (stems) rising from it, a blade on a gas-filled
// float at every node, and the stipes that reach the top lying along the surface as a canopy. Each stipe is a chain
// (see chains.ts).

export const NODES = 16;

// Patches of bare sand out ahead of the eye's start, where the crabs walk: nothing tall grows on them, so they are seen.
// How many crabs keep to each.
export const CLEARINGS = [
  { x: 2.2, z: 3.4, r: 1.1, crabs: 3 },
  { x: -0.9, z: 2.5, r: 0.9, crabs: 2 }
];
export const inClearing = (x: number, z: number, margin = 0.25) => CLEARINGS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + margin);

// thick scales the stipe's girth: side branches are thinner than the stems they grow from.
export type Stipe = { plant: number; length: number; thick: number };
export type Plant = { x: number; z: number; y: number; size: number };

// Where the floor is, roughly, for rooting things: low swells and a rise to one side.
export function floorAt(x: number, z: number) {
  return 0.35 * Math.sin(0.21 * x + 0.4) * Math.cos(0.17 * z - 0.2) + 0.18 * Math.sin(0.5 * x - 0.37 * z + 1.3) + 0.6 * Math.exp(-((x + 7) ** 2 + (z + 4) ** 2) / 30) + 0.07 * Math.sin(1.3 * x + 0.9 * z);
}

export class Forest {
  plants: Plant[] = [];
  stipes: Stipe[] = [];
  chains: Chains;

  constructor(seed: number) {
    const random = lehmer(seed);
    // A few big plants, each a full bush of stipes: four in front of the start, where they are seen close, and three
    // out in the haze behind for depth. Low kelp everywhere else (sugar.tsx) carries the forest floor.
    const PLACES: [number, number, number][] = [
      [0.6, 1.6, 1.15],
      [-2.6, -0.6, 1.1],
      [3.3, 1.9, 1],
      [-0.2, -4.4, 1.2],
      [-7, -10, 1],
      [6, -11.5, 1],
      [11, -3.5, 0.9]
    ];
    for (const [x, z, size] of PLACES) this.plants.push({ x, z, y: floorAt(x, z), size });
    const specs: ConstructorParameters<typeof Chains>[0] = [];
    this.plants.forEach((plant, index) => {
      const stems = 4 + Math.floor(random() * 3 * plant.size);
      for (let s = 0; s < stems; s++) {
        const a = random() * Math.PI * 2;
        const root = new THREE.Vector3(plant.x + Math.cos(a) * 0.12, plant.y + 0.12, plant.z + Math.sin(a) * 0.12);
        // Some reach the top and lie along it; the rest are young, stopping anywhere on their way up.
        const grown = random() < 0.55;
        const length = grown ? (SURFACE - root.y) * (1.15 + random() * 0.55) : (SURFACE - root.y) * (0.2 + random() * 0.6);
        this.stipes.push({ plant: index, length, thick: 1 });
        specs.push({ root, length, lift: 0.6 + random() * 0.6, lean: new THREE.Vector3(random() - 0.5, 1.6, random() - 0.5) });
      }
    });
    // Side branches off the stems partway up, short, ending well below the surface.
    const stems = specs.length;
    for (let i = 0; i < stems; i++) {
      const branches = random() < 0.45 ? 1 : 0;
      for (let b = 0; b < branches; b++) {
        const node = 2 + Math.floor(random() * Math.max(1, NODES - 6));
        const from = specs[i];
        const up = Math.min(1, (node / (NODES - 1)) * (from.length / (SURFACE - from.root.y)));
        const root = from.root.clone().setY(from.root.y + up * (SURFACE - from.root.y) * 0.8);
        const length = Math.min(SURFACE - root.y - 0.5, 0.9 + random() * 2.6);
        if (length < 0.6) continue;
        this.stipes.push({ plant: this.stipes[i].plant, length, thick: 0.6 });
        specs.push({ root, length, lift: 0.5 + random() * 0.5, lean: new THREE.Vector3(random() - 0.5, 1, random() - 0.5), parent: i * NODES + node });
      }
    }
    this.chains = new Chains(specs, NODES, { ground: floorAt });
  }
}
