import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// The orbit camera, shared: the scene reads where the view turns about (orbitPoint) and can tune its limits.
export const orbitControls: { current: OrbitControls | null } = { current: null };
export const orbitPoint: { current: THREE.Vector3 | null } = { current: null };

export function Orbit({ target, phoneTarget }: { target: [number, number, number]; phoneTarget?: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  useEffect(() => {
    const controls = new OrbitControls(camera, dom);
    const phone = phoneTarget && Math.min(window.innerWidth, window.innerHeight) < 600;
    controls.target.set(...(phone ? phoneTarget : target));
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.7;
    controls.panSpeed = 0.6;
    controls.minDistance = 0.6;
    controls.maxDistance = 15;
    controls.update();
    orbitControls.current = controls;
    orbitPoint.current = controls.target;
    return () => {
      controls.dispose();
      orbitControls.current = null;
      orbitPoint.current = null;
    };
  }, [camera, dom]);
  useFrame(() => orbitControls.current?.update(), -1);
  return null;
}

type Grabbable = {
  holdToGrab?: number;
  pick: (ray: THREE.Ray) => { distance: number; point: THREE.Vector3 } | null;
  grab: (point: THREE.Vector3) => void;
  drag: (point: THREE.Vector3) => void;
  release: () => void;
};

// Press and hold on something to take hold of it: if the pointer stays put for holdToGrab ms over something pick()
// finds, it is grabbed and the orbit is paused; then it follows the pointer across a plane facing the eye through the
// point it was taken at, until let go. A quick drag still turns the view.
export function useGrabbable(options: Grabbable) {
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane();
    const point = new THREE.Vector3();
    let timer = 0;
    let pending: { x: number; y: number; id: number; point: THREE.Vector3 } | null = null;
    let held: { id: number } | null = null;
    const toRay = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray;
    };
    const cancel = () => {
      window.clearTimeout(timer);
      pending = null;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || held) return;
      const hit = latest.current.pick(toRay(e).clone());
      if (!hit) return;
      pending = { x: e.clientX, y: e.clientY, id: e.pointerId, point: hit.point.clone() };
      timer = window.setTimeout(() => {
        if (!pending) return;
        held = { id: pending.id };
        const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
        plane.setFromNormalAndCoplanarPoint(normal, pending.point);
        if (orbitControls.current) orbitControls.current.enabled = false;
        dom.style.cursor = "grabbing";
        latest.current.grab(pending.point);
        pending = null;
      }, latest.current.holdToGrab ?? 200);
    };
    const move = (e: PointerEvent) => {
      if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 6) cancel();
      if (!held || e.pointerId !== held.id) return;
      if (toRay(e).intersectPlane(plane, point)) latest.current.drag(point.clone());
    };
    const up = (e: PointerEvent) => {
      cancel();
      if (!held || e.pointerId !== held.id) return;
      held = null;
      if (orbitControls.current) orbitControls.current.enabled = true;
      dom.style.cursor = "";
      latest.current.release();
    };
    dom.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      cancel();
      dom.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [camera, dom]);
}
