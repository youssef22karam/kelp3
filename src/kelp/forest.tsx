
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { useGrabbable } from "./engine/controls";
import { BANDS, fillColumns } from "./avoid";
import { Bubbles } from "./bubbles";
import { Crabs } from "./crabs";
import { Fishes } from "./fish";
import { Growth, Pebbles, Rocks, Sand, placeStones, useFloorAssets } from "./floor";
import { Chains } from "./chains";
import { Forest, floorAt } from "./kelp";
import { Rafts } from "./rafts";
import { plantKelp, plantPatches, Ribbons } from "./sugar";
import { Kelp } from "./plants";
import { Shafts, Surface } from "./sea";
import { holding, voice } from "./voices";
import { SURFACE } from "./water";
import { LOOKS } from "./versions";

// The kelp forest: giant kelp rising from a rocky floor to lie along the surface, sugar kelp streaming low on the rocks,
// patches of little kelps, rafts of sargassum adrift overhead, bubbles rising from the rocks, and fish from sardines
// to sharks out in the haze.
export function ForestScene({ active, fine, startFine }: { active: boolean; fine: number; startFine: number }) {
  const look = LOOKS.forest;
  const forest = useMemo(() => new Forest(48271), []);
  const stones = useMemo(() => placeStones(733, forest.plants, fine), [forest, fine]);
  // Sugar kelp and finger kelp low on the rocks and cobbles between the giants.
  const sugar = useMemo(() => {
    const planted = plantKelp(stones, fine, forest.plants);
    return { ...planted, chains: new Chains(planted.specs, fine > 0.6 ? 8 : 6, { ground: floorAt, ceiling: SURFACE - 0.6, drag: [1.2, 2.6], rate: 1 / 30 }) };
  }, [stones, fine, forest]);
  const patches = useMemo(() => {
    const planted = plantPatches(stones, fine, forest.plants);
    return { ...planted, chains: new Chains(planted.specs, 5, { ground: floorAt, ceiling: SURFACE - 0.6, drag: [1.4, 2.8], rate: 1 / 30 }) };
  }, [stones, fine, forest]);
  if (import.meta.env.DEV) Object.assign(globalThis, { __forest: forest });
  // Where the kelp stands at each height, for the fish to swim round.
  const columns = useMemo(() => new Float32Array(forest.plants.length * BANDS * 4), [forest]);
  useFrame((_, raw) => {
    if (!active) return;
    const delta = Math.min(raw, 1 / 15);
    forest.chains.update(delta);
    fillColumns(forest, columns);
    sugar.chains.update(delta);
    patches.chains.update(delta);
  });

  // Press and hold on a kelp to take hold of it and pull it about; let go and the water takes it back.
  const camera = useThree((state) => state.camera);
  const held = useRef<{ chains: Chains; pan: number } | null>(null);
  const picked = useRef<{ chains: Chains; chain: number; node: number } | null>(null);
  const sets = [
    { chains: forest.chains, reach: 0.2 },
    { chains: sugar.chains, reach: 0.12 },
    { chains: patches.chains, reach: 0.1 }
  ];
  const panOf = (point: THREE.Vector3) => THREE.MathUtils.clamp(point.clone().project(camera).x * 0.5, -0.6, 0.6);
  useGrabbable({
    holdToGrab: 220,
    pick: (ray) => {
      let best: { chains: Chains; hit: [number, number, number] } | null = null;
      for (const { chains, reach } of sets) {
        const hit = chains.nearest(ray, reach);
        if (hit && (!best || hit[2] < best.hit[2])) best = { chains, hit };
      }
      if (!best) return null;
      picked.current = { chains: best.chains, chain: best.hit[0], node: best.hit[1] };
      return { distance: best.hit[2], point: ray.at(best.hit[2], new THREE.Vector3()) };
    },
    grab: (point) => {
      const p = picked.current;
      if (!p) return;
      p.chains.hold = { chain: p.chain, node: p.node, target: point.clone() };
      held.current = { chains: p.chains, pan: panOf(point) };
      holding.on = true;
      voice.grab(held.current.pan);
    },
    drag: (point) => {
      const h = held.current;
      if (!h?.chains.hold) return;
      // Kept under the surface and above the floor.
      h.chains.hold.target.set(point.x, THREE.MathUtils.clamp(point.y, floorAt(point.x, point.z) + 0.1, SURFACE - 0.1), point.z);
      h.pan = panOf(point);
    },
    release: () => {
      const h = held.current;
      if (!h) return;
      h.chains.hold = null;
      held.current = null;
      holding.on = false;
      holding.at = performance.now();
      voice.release(h.pan);
    }
  });

  return (
    <group visible={active}>
      <Surface fine={fine} />
      <Shafts count={Math.round(28 * fine)} long={18} spread={18} />
      <Kelp forest={forest} blade={look.blade} stipe={look.stipe} fine={fine} active={active} />
      <Ribbons chains={sugar.chains} blades={sugar.blades} colour="#7a6424" fine={fine} active={active} />
      <Ribbons chains={patches.chains} blades={patches.blades} colour="#6a5a22" fine={fine * 0.7} active={active} />
      <Rafts fine={fine} active={active} />
      <Bubbles stones={stones} fine={fine} />
      <Crabs active={active} />
      <Suspense fallback={null}>
        <Floor startFine={startFine} forest={forest} stones={stones} fine={fine} />
      </Suspense>
      <Fishes schools={look.schools} active={active} seed={11} />
    </group>
  );
}

function Floor({ startFine, forest, stones, fine }: { startFine: number; forest: Forest; stones: ReturnType<typeof placeStones>; fine: number }) {
  const assets = useFloorAssets(startFine > 0.6);
  return (
    <>
      <Sand assets={assets} tint={LOOKS.forest.sand} fine={fine} />
      <Rocks assets={assets} stones={stones} crust={["#c88a8a", "#8a9a5a"]} />
      <Pebbles assets={assets} count={Math.round(320 * fine)} plants={forest.plants} tint={LOOKS.forest.sand} />
      <Growth stones={stones} plants={forest.plants} fine={fine} />
    </>
  );
}
