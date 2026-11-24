
import { useEffect, useRef, useSyncExternalStore } from "react";
import { sound } from "./engine/sound";
import { LOOKS } from "./versions";
import { aimSun } from "./water";

// Where the sun stands: its bearing in degrees round the forest (as the sea reads it: 0 along +x, turning toward +z),
// and how high it shows under water, from low over the water's edge to nearly overhead.
const LOW = 18;
const HIGH = 85;
const state = { bearing: LOOKS.forest.bearing, seen: LOOKS.forest.seen ?? 34 };
let snapshot = { ...state };
const listeners = new Set<() => void>();
export const sunPlace = {
  get: () => snapshot,
  set(bearing: number, seen: number) {
    state.bearing = bearing;
    state.seen = Math.min(HIGH, Math.max(LOW, seen));
    snapshot = { ...state };
    aimSun(state.bearing, state.seen);
    listeners.forEach((listener) => listener());
  }
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const SIZE = 220;
const TICKS = Array.from({ length: 72 }, (_, i) => i * 5);

// A dial for the sun, seen from above with the far side at the top. Drag the sun round it to bring the light in from
// another side, and in toward the middle to raise it overhead, out to the rim to bring it down low. Its face is a ring of
// fine ticks that turns with the sun like a knob, clicking as it goes, and rings for its height. It sits where Caustic's
// light dial does.
export function SunDial() {
  const value = useSyncExternalStore(subscribe, sunPlace.get, sunPlace.get);
  const dial = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, lastTick: 0, lastClick: 0 });

  useEffect(() => {
    const element = dial.current;
    if (!element) return;
    const aim = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const reach = Math.hypot(dx, dy) / ((box.width / 2) * (1 - 28 / SIZE));
      if (reach < 0.04) return;
      // Screen right is the forest's +x and screen down its +z, toward where the eye starts.
      const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
      const seen = HIGH - Math.min(1, reach) * (HIGH - LOW);
      // A click for every tick that passes, as on a ratchet, but no more than one every 30 ms however fast it spins.
      const step = Math.round(bearing / 5) * 100 + Math.round(seen / 5);
      const now = performance.now();
      if (step !== drag.current.lastTick && now - drag.current.lastClick > 30) {
        drag.current.lastTick = step;
        drag.current.lastClick = now;
        sound.play("click", { gain: 0.3, pitch: 0.8 + (seen / HIGH) * 0.4 });
      }
      sunPlace.set(bearing, seen);
    };
    const down = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      drag.current.active = true;
      element.setPointerCapture(event.pointerId);
      aim(event);
    };
    const move = (event: PointerEvent) => {
      if (drag.current.active) aim(event);
    };
    const up = () => {
      drag.current.active = false;
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, []);

  const r = SIZE / 2;
  const ring = r - 14;
  const angle = (value.bearing * Math.PI) / 180;
  const out = ((HIGH - value.seen) / (HIGH - LOW)) * ring;
  const sx = r + Math.cos(angle) * out;
  const sy = r + Math.sin(angle) * out;

  return (
    <div className="cv-kelp-sun">
      <style>{`
        .cv-kelp-sun { position: absolute; right: 88px; bottom: 120px; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; z-index: 5; }
        .cv-kelp-sun .dial { pointer-events: auto; touch-action: none; cursor: grab; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
          background: radial-gradient(circle at 50% 40%, rgba(40, 92, 96, 0.5), rgba(6, 24, 30, 0.74) 70%);
          box-shadow: inset 0 0 0 1px rgba(200, 240, 230, 0.16), 0 10px 30px rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
        .cv-kelp-sun .dial:active { cursor: grabbing; }
        .cv-kelp-sun .label { font: 500 11px/1 inherit; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(225, 245, 238, 0.66); }
        @media (max-width: 720px) {
          .cv-kelp-sun { right: 24px; bottom: 104px; gap: 4px; }
          .cv-kelp-sun .dial { width: 112px; height: 112px; }
          .cv-kelp-sun .label { font-size: 10px; }
        }
      `}</style>
      <div ref={dial} className="dial" role="slider" aria-label="Where the sun is" aria-valuemin={LOW} aria-valuemax={HIGH} aria-valuenow={Math.round(value.seen)}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%">
          <defs>
            <radialGradient id="cv-kelp-sun-glow">
              <stop offset="0" stopColor="#fffbe8" stopOpacity="1" />
              <stop offset="0.35" stopColor="#ffe9a8" stopOpacity="0.8" />
              <stop offset="1" stopColor="#ffd970" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="cv-kelp-beam" x1={sx} y1={sy} x2={r} y2={r} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff0c0" stopOpacity="0.5" />
              <stop offset="1" stopColor="#fff0c0" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Rings for the sun's height: the rim is low, the middle overhead. */}
          {[0.33, 0.66].map((f) => (
            <circle key={f} cx={r} cy={r} r={ring * f} fill="none" stroke="rgba(200, 240, 230, 0.12)" strokeWidth="1" />
          ))}
          <g transform={`rotate(${value.bearing} ${r} ${r})`}>
            {TICKS.map((t) => {
              const a = (t * Math.PI) / 180;
              const major = t % 30 === 0;
              const outer = r - 4;
              const inner = outer - (major ? 8 : 4);
              return <line key={t} x1={r + Math.cos(a) * inner} y1={r + Math.sin(a) * inner} x2={r + Math.cos(a) * outer} y2={r + Math.sin(a) * outer} stroke={major ? "rgba(200, 240, 230, 0.6)" : "rgba(200, 240, 230, 0.22)"} strokeWidth={major ? 1.5 : 1} strokeLinecap="round" />;
            })}
          </g>
          <line x1={sx} y1={sy} x2={r} y2={r} stroke="url(#cv-kelp-beam)" strokeWidth="8" strokeLinecap="round" />
          <circle cx={r} cy={r} r="2.5" fill="rgba(200, 240, 230, 0.7)" />
          <circle cx={sx} cy={sy} r="17" fill="url(#cv-kelp-sun-glow)" />
          <circle cx={sx} cy={sy} r="5.5" fill="#fffbec" />
        </svg>
      </div>
      <div className="label">Sun</div>
    </div>
  );
}
