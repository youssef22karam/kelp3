import { useSyncExternalStore } from "react";

// A tiny store of user-facing settings, read by the scene and written by the UI.
type Value = number | boolean | string;
const values: Record<string, Value> = {
  current: 0.3,
  desk: false,
  head: false
};
const listeners = new Set<() => void>();

const store = {
  get: (name: string) => values[name],
  set(name: string, value: Value) {
    if (values[name] === value) return;
    values[name] = value;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }
};

export const settings = store;
export const useSettingsStore = () => store;

export function useSetting<T extends Value>(name: string): T {
  return useSyncExternalStore(store.subscribe, () => values[name] as T, () => values[name] as T);
}
