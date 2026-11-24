import { useSyncExternalStore } from "react";

export type Tier = "low" | "medium" | "high";

export const narrowScreen = () => typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 600;

function guessTier(): Tier {
  if (typeof window === "undefined") return "medium";
  const fromUrl = new URLSearchParams(window.location.search).get("quality");
  if (fromUrl === "low" || fromUrl === "medium" || fromUrl === "high") return fromUrl;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (coarse || narrowScreen()) return "low";
  return "medium";
}

let tier: Tier = guessTier();
const listeners = new Set<() => void>();

export const quality = {
  get: () => tier,
  set(next: Tier) {
    if (next === tier) return;
    tier = next;
    listeners.forEach((l) => l());
  }
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useQuality() {
  const t = useSyncExternalStore(subscribe, quality.get, quality.get);
  return { tier: t };
}

// Whether the scene is showing (as opposed to warming up behind a loader).
export const scenePhase = { current: "live" as "loading" | "live" };
