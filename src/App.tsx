import { Canvas, extend, useFrame } from "@react-three/fiber";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three/webgpu";
import { Orbit } from "./kelp/engine/controls";
import { Post } from "./kelp/engine/Post";
import { quality, useQuality, type Tier } from "./kelp/engine/quality";
import { settings, useSetting } from "./kelp/engine/settings";
import { sound } from "./kelp/engine/sound";
import kelp, { Scene } from "./kelp/index";
import { floorAssets } from "./kelp/procedural";

// R3F's elements (<directionalLight> and the rest) built from the WebGPU build of three.
extend(THREE as unknown as Parameters<typeof extend>[0]);

const fineOf = (tier: Tier) => (tier === "low" ? 0.5 : tier === "medium" ? 0.75 : 1);

const fpsState = { value: 60, listeners: new Set<() => void>() };
function FpsMeter() {
  const frames = useRef(0);
  const last = useRef(performance.now());
  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (now - last.current >= 500) {
      fpsState.value = Math.round((frames.current * 1000) / (now - last.current));
      frames.current = 0;
      last.current = now;
      fpsState.listeners.forEach((l) => l());
    }
  });
  return null;
}

function useFps() {
  const [fps, setFps] = useState(fpsState.value);
  useEffect(() => {
    const update = () => setFps(fpsState.value);
    fpsState.listeners.add(update);
    return () => {
      fpsState.listeners.delete(update);
    };
  }, []);
  return fps;
}

class Guard extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || String(error) };
  }
  render() {
    if (this.state.error)
      return (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-teal-50/80">
          <div>
            <p className="mb-2 text-lg">The water could not be drawn on this device.</p>
            <p className="text-sm opacity-60">{this.state.error}</p>
          </div>
        </div>
      );
    return this.props.children;
  }
}

function Loader({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#02141a] text-teal-50">
      <div className="relative mb-6 h-16 w-16">
        <div className="absolute inset-0 animate-ping rounded-full bg-teal-300/20" />
        <div className="absolute inset-3 rounded-full bg-gradient-to-b from-teal-200/70 to-teal-700/40" />
      </div>
      <p className="text-xs uppercase tracking-[0.3em] text-teal-100/70">{label}</p>
    </div>
  );
}

function Panel() {
  const current = useSetting<number>("current");
  const { tier } = useQuality();
  const fps = useFps();
  const [muted, setMuted] = useState(sound.muted);
  const [open, setOpen] = useState(false);
  const def = kelp.settings.current;
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-10 w-[min(320px,calc(100vw-2rem))] select-none rounded-2xl border border-teal-100/10 bg-[#06181e]/70 p-3.5 text-teal-50 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-wide">Kelp</h1>
            <span className="rounded-full bg-teal-300/15 px-2 py-0.5 font-mono text-[10px] text-teal-200">{fps} FPS</span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-teal-100/50">All procedural · no models</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => {
              sound.setMuted(!muted);
              setMuted(!muted);
            }}
            className="rounded-full border border-teal-100/15 px-2.5 py-1 text-xs text-teal-50/80 hover:bg-teal-100/10"
          >
            {muted ? "Muted" : "Sound"}
          </button>
          <button onClick={() => setOpen(!open)} className="rounded-full border border-teal-100/15 px-2.5 py-1 text-xs text-teal-50/80 hover:bg-teal-100/10">
            {open ? "Less" : "More"}
          </button>
        </div>
      </div>
      <label className="mt-3 block">
        <div className="mb-1 flex justify-between text-xs text-teal-100/70">
          <span>{def.label}</span>
          <span>{current.toFixed(2)}</span>
        </div>
        <input type="range" min={def.min} max={def.max} step={def.step} value={current} onChange={(e) => settings.set("current", parseFloat(e.target.value))} className="w-full accent-teal-300" />
      </label>
      <div className="mt-2.5 flex items-center gap-2 text-xs text-teal-100/70">
        <span>Quality</span>
        {(["low", "medium", "high"] as Tier[]).map((t) => (
          <button key={t} onClick={() => quality.set(t)} className={`rounded-full px-2.5 py-0.5 capitalize ${t === tier ? "bg-teal-200/80 text-[#06181e]" : "border border-teal-100/15 hover:bg-teal-100/10"}`}>
            {t}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-teal-50/60">{kelp.hint}</p>
      {open && (
        <div className="mt-3 max-h-[45vh] space-y-3 overflow-y-auto pr-1 text-xs leading-relaxed text-teal-50/70">
          <p className="text-teal-50/80">{kelp.notes}</p>
          {kelp.overview.map((section) => (
            <div key={section.title}>
              <h2 className="mb-1 font-semibold text-teal-100">{section.title}</h2>
              <ul className="list-disc space-y-1 pl-4">
                {section.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-teal-100/50">Sand, pebbled sand and rock textures, the ten rock shapes and all sound are generated in code at load.</p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { tier } = useQuality();
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);

  // Grow the floor's textures and rocks before the scene mounts, so the first frames are not a stall.
  useEffect(() => {
    const id = window.setTimeout(() => {
      floorAssets(fineOf(tier) > 0.6);
      setReady(true);
    }, 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phone = Math.min(window.innerWidth, window.innerHeight) < 600;
  const cam = phone ? kelp.camera.phone : kelp.camera;
  const Overlay = kelp.Overlay;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {ready && (
        <Guard>
          <Canvas
            className="absolute inset-0"
            dpr={tier === "high" ? [1, 1.25] : 1}
            camera={{ position: cam.position as [number, number, number], fov: cam.fov, near: 0.05, far: 160 }}
            gl={async (props) => {
              const renderer = new THREE.WebGPURenderer({ ...(props as object), antialias: false, powerPreference: "high-performance" } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
              await renderer.init();
              renderer.setClearColor(0x000000, 1);
              renderer.toneMapping = THREE.ACESFilmicToneMapping;
              return renderer;
            }}
            onCreated={() => window.setTimeout(() => setShown(true), 200)}
          >
            <Orbit target={kelp.camera.target as [number, number, number]} phoneTarget={kelp.camera.phone.target as [number, number, number]} />
            <Scene />
            <Post range={kelp.passes.depthOfField.range} />
            <FpsMeter />
          </Canvas>
          {/* Subtle zero-cost CSS vignette framing the underwater view */}
          <div
            className="pointer-events-none fixed inset-0 z-[2]"
            style={{ background: "radial-gradient(circle at 50% 45%, transparent 52%, rgba(2, 14, 20, 0.55) 100%)" }}
          />
          <Overlay />
          <Panel />
        </Guard>
      )}
      {!shown && <Loader label={ready ? "Filling the water" : "Growing the sea floor"} />}
    </div>
  );
}
