import { useEffect, useRef } from "react";

type Disposable = { dispose: () => void } | null | undefined;

// Frees GPU resources (geometries, materials, textures) when they are replaced or the component unmounts.
export function useDispose(...items: Disposable[]) {
  const held = useRef<Disposable[]>([]);
  const changed = items.length !== held.current.length || items.some((item, i) => item !== held.current[i]);
  const previous = useRef<Disposable[]>([]);
  if (changed) {
    previous.current = held.current;
    held.current = items;
  }
  useEffect(() => {
    if (previous.current.length) {
      const stale = previous.current.filter((p) => !held.current.includes(p));
      stale.forEach((p) => p?.dispose());
      previous.current = [];
    }
  });
  useEffect(
    () => () => {
      held.current.forEach((p) => p?.dispose());
    },
    []
  );
}
