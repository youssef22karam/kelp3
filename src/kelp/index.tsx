
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { orbitControls, orbitPoint } from "./engine/controls";
import { focusBlur, focusDistance } from "./engine/Post";
import { useQuality } from "./engine/quality";
import { useSetting } from "./engine/settings";
import { useMusic } from "./engine/sound";
import { useLook } from "./engine/Stage";
import { ForestScene } from "./forest";
import { Atmosphere } from "./atmosphere";
import { Backdrop, Light, Snow } from "./sea";
import { SunDial } from "./sundial";
import { ageStirs, stir } from "./stir";
import { LOOKS } from "./versions";
import { holding, voice } from "./voices";
import { SURFACE, advance, aim, ease, motion, sea } from "./water";

const LOOK = {
  background: "#000000",
  gi: 0,
  ao: 0.35,
  aoRadius: 0.3,
  vignette: 0.55,
  grain: 0.02,
  bloomThreshold: 0.75,
  haze: 0
};

// How much the water has been stirred since the page opened, for the follow card's moment.
const stirring = { amount: 0, bursts: 0, earned: false };

export function Scene() {
  const look = LOOKS.forest;
  const current = useSetting<number>("current");
  motion.strength = current;
  useMusic("procedural", 0.4); // synthesised ambience, no audio file
  // The current sounds as it is turned up or down.
  const lastCurrent = useRef(current);
  useEffect(() => {
    if (Math.abs(current - lastCurrent.current) < 0.02) return;
    lastCurrent.current = current;
    voice.current(current);
  }, [current]);
  const { tier } = useQuality();
  const fine = tier === "low" ? 0.5 : tier === "medium" ? 0.75 : 1;
  // Assets are loaded by the tier the visit starts on, so a later step down never reloads and remounts a scene.
  const startFine = useRef(fine).current;
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const dom = useThree((state) => state.gl.domElement) as HTMLCanvasElement;
  const scene = useThree((state) => state.scene);
  if (import.meta.env.DEV) Object.assign(globalThis, { __sea: sea, __kelpRoot: scene, __camera: camera });


  useLook(useMemo(() => ({ ...LOOK, exposure: look.exposure, bloom: look.bloom }), [look]));
  const first = useRef(true);
  useEffect(() => {
    aim(look, first.current);
    first.current = false;
  }, [look]);

  // For testing in development: put the eye somewhere from the console.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (globalThis as Record<string, unknown>).__view = (from: number[], to: number[]) => {
      camera.position.set(from[0], from[1], from[2]);
      orbitPoint.current?.set(to[0], to[1], to[2]);
      camera.lookAt(to[0], to[1], to[2]);
    };
    // And where it is now, to copy into the camera below.
    (globalThis as Record<string, unknown>).__where = () => {
      const round = (v: THREE.Vector3) => v.toArray().map((n) => Math.round(n * 100) / 100);
      return JSON.stringify({ position: round(camera.position), target: orbitPoint.current ? round(orbitPoint.current) : null, fov: camera.fov });
    };
  }, [camera]);

  // The eye never wanders off into the haze.
  useEffect(() => {
    const orbit = orbitControls.current;
    if (!orbit) return;
    const before = orbit.maxDistance;
    orbit.maxDistance = 13;
    return () => {
      orbit.maxDistance = before;
    };
  }, []);

  // The pointer stirs the water: its line through the scene, sweeping sideways, pushes the water along with it. A tap
  // sends a surge out from where it lands.
  const pointer = useRef({ x: 0, y: 0, fresh: false, inside: false, down: null as null | { x: number; y: number; at: number } });
  useEffect(() => {
    const at = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    const move = (e: PointerEvent) => {
      // A drag turns the view; only a mouse moving free stirs.
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      const p = at(e);
      pointer.current.x = p.x;
      pointer.current.y = p.y;
      pointer.current.fresh = true;
      pointer.current.inside = true;
    };
    const leave = () => (pointer.current.inside = false);
    const down = (e: PointerEvent) => (pointer.current.down = { ...at(e), at: performance.now() });
    const up = (e: PointerEvent) => {
      const d = pointer.current.down;
      pointer.current.down = null;
      // Letting go of a kelp is not a tap.
      if (!d || holding.on || performance.now() - holding.at < 100) return;
      const p = at(e);
      if (Math.hypot(p.x - d.x, p.y - d.y) < 0.03 && performance.now() - d.at < 400) burst(p.x, p.y);
    };
    dom.addEventListener("pointermove", move);
    dom.addEventListener("pointerleave", leave);
    dom.addEventListener("pointerdown", down);
    dom.addEventListener("pointerup", up);
    return () => {
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("pointerleave", leave);
      dom.removeEventListener("pointerdown", down);
      dom.removeEventListener("pointerup", up);
    };
  });

  const ray = useMemo(() => new THREE.Raycaster(), []);
  const was = useRef<THREE.Vector3 | null>(null);
  const glowAt = useRef(0);
  const glow = (point: THREE.Vector3, strength: number) => {
    const slot = sea.stirs.array[glowAt.current++ % 8] as THREE.Vector4;
    slot.set(point.x, point.y, point.z, strength);
  };
  const burst = (x: number, y: number) => {
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const reach = THREE.MathUtils.clamp(camera.position.distanceTo(orbitPoint.current ?? new THREE.Vector3()), 1.5, 8);
    const point = ray.ray.at(reach, new THREE.Vector3());
    stir({ origin: point, dir: ray.ray.direction.clone(), sweep: new THREE.Vector3(), burst: 1.4, at: point });
    glow(point, 1.6);
    voice.tap(x * 0.5);
    if (++stirring.bursts >= 6) earn();
  };
  const earn = () => {
    if (stirring.earned) return;
    stirring.earned = true;
    window.dispatchEvent(new CustomEvent("kelp:earned"));
  };

  const scratch = useMemo(() => new THREE.Vector3(), []);
  // Smoothed frame time, so one slow frame does not jerk everything forward.
  const steady = useRef(1 / 60);
  useFrame((_, raw) => {
    steady.current += (Math.min(raw, 1 / 15) - steady.current) * 0.2;
    const delta = steady.current;
    sea.clock.value += delta;
    advance(delta);
    ease(1 - Math.exp(-delta * 2));
    ageStirs(delta);

    // A sweep of the pointer, as a line moving sideways through the water.
    const p = pointer.current;
    if (p.inside) {
      ray.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
      const dir = ray.ray.direction.clone();
      if (was.current && p.fresh) {
        const sweep = dir.clone().sub(was.current).divideScalar(Math.max(raw, 1e-3));
        const speed = sweep.length();
        if (speed > 0.02) {
          sweep.multiplyScalar(Math.min(1, 1.6 / speed) * 0.25);
          stir({ origin: camera.position.clone(), dir, sweep, burst: 0, at: new THREE.Vector3() });
          const reach = camera.position.distanceTo(orbitPoint.current ?? scratch);
          glow(ray.ray.at(reach, scratch), Math.min(1, speed * 0.6));
          stirring.amount += speed * raw;
          if (speed > 1.2) voice.sweep(speed, p.x * 0.5);
          if (stirring.amount > 6) earn();
        }
      }
      was.current = dir;
      p.fresh = false;
    } else was.current = null;
    // The plankton's glow fades.
    for (const slot of sea.stirs.array as THREE.Vector4[]) slot.w *= Math.exp(-delta * 1.2);

    // Under the surface and above the floor.
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.5, SURFACE - 0.5);
    // Focus on whatever the view turns about.
    const focus = Math.max(0.6, camera.position.distanceTo(orbitPoint.current ?? scratch));
    focusDistance.value = focus;
    focusBlur.value = 1.5 * THREE.MathUtils.clamp(4 / focus, 0.5, 1.2);
  });

  return (
    <>
      <Backdrop />
      <Light />
      <Snow count={Math.round((tier === "low" ? 240 : tier === "medium" ? 420 : 650) * look.snow)} />
      <Snow silt count={Math.round((tier === "low" ? 280 : tier === "medium" ? 480 : 750) * look.snow)} />
      <Atmosphere motes={tier === "low" ? 70 : tier === "medium" ? 120 : 180} />
      <Atmosphere rising motes={tier === "low" ? 160 : tier === "medium" ? 280 : 440} />
      <ForestScene active fine={fine} startFine={startFine} />
    </>
  );
}

export const kelp = {
  camera: {
    // Low among the grass, looking up through the kelp toward the sun.
    position: [0.9, 0.6, 7.6],
    target: [2.9, 3.2, 1.5],
    fov: 56,
    phone: { position: [0.7, 0.65, 9.2], target: [3, 4.2, 1.6], fov: 64 }
  },
  hover: true,
  extents: { centre: [0, 4, 0], radius: 15 },
  look: { ...LOOK, exposure: 1.05, bloom: 0.35 },
  passes: { haze: false, bounce: false, overlay: true, depthOfField: { range: 5 } },
  settings: {
    current: { type: "range", label: "Current", min: 0, max: 2.5, step: 0.01, value: 0.3 },
    desk: { type: "toggle", label: "Desktop", value: false, hidden: true }
  },
  overview: [
    {
      title: "The kelp",
      points: [
        "Seven giant kelp, four detailed near the start and three coarse in the haze, with forking haptera, stipes, floats and blades.",
        "Each stipe is a CPU point chain driven by water drag and float lift, held to length from the root so it never stretches.",
        "Blades bend on the GPU to stream with the flow; press and hold drags a stipe toward the pointer along its chain."
      ]
    },
    {
      title: "The water and light",
      points: [
        "Swell sways the water less with depth over a steady current; pointer sweeps push the water and taps send surges.",
        "Caustics are traced up to the moving surface toward the sun, and soft light shafts swing round with the sun dial.",
        "The sky shows through Snell's window, bent by each wave's slope; outside it the surface mirrors the lit water below.",
        "Water darkens away from the sun; plankton at the lens blur into bokeh, and marine snow rises glinting through the shafts."
      ]
    },
    {
      title: "Life",
      points: [
        "Pacific rock crabs walk sideways in an alternating tetrapod, each segmented leg solved per frame as hinges in one plane.",
        "Fish tail beats come from CPU speed fed to the GPU as phase and strength; schools steer round the kelp, not through it."
      ]
    },
    {
      title: "The floor",
      points: [
        "Procedural sand on a mesh finest near the eye, with noise-sculpted reef rocks, thousands of pebbles and surfgrass bending in the swell.",
        "Bubble positions are computed from time on the GPU with nothing sent per frame, while silt and specks give the water depth."
      ]
    }
  ],
  hint: "Sweep the pointer through the kelp to stir the water. Tap to send a surge. Press and hold on a kelp to pull it about, and turn the dial to move the sun.",
  Overlay: () => <SunDial />,
  notes: "A kelp forest under a moving surface: giant kelp to the top, sugar kelp on the rocks, sargassum adrift overhead, and fish from sardines to sharks. Sweep through it and the water moves.",
  Scene
};

export default kelp;
export { LOOK };
