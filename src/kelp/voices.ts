import { sound } from "./engine/sound";

// What playing with the forest sounds like: bubbles. A sweep of the hand through the water sends up a patter of them, a
// tap a burst, taking hold of a kelp a gulp and letting it go a rising run, and turning the current a single one, higher
// the stronger it runs. All of it from the shared synthesised sounds.

// How much louder than the shared sounds' own level the bubbles play, to be heard over the music.
const LOUD = 2;

export const voice = {
  // speed is how fast the hand sweeps, about 1 to 4; pan is where across the view.
  sweep(speed: number, pan: number) {
    const loud = Math.min(1, speed / 4);
    sound.play("plop", { gain: LOUD * (0.06 + loud * 0.12), pitch: 0.9 + Math.random() * 0.9, pan, gap: 0.07 });
    if (Math.random() < loud) sound.play("drip", { gain: LOUD * (0.05 + loud * 0.06), pitch: 0.6 + Math.random() * 0.6, pan, gap: 0.11 });
  },

  tap(pan: number) {
    for (let i = 0; i < 6; i++) window.setTimeout(() => sound.play("plop", { gain: LOUD * (0.14), pitch: 0.7 + Math.random() * 1.2, pan: pan + (Math.random() - 0.5) * 0.4 }), i * 45 + Math.random() * 30);
  },

  grab(pan: number) {
    sound.play("plop", { gain: LOUD * (0.2), pitch: 0.55, pan });
  },

  release(pan: number) {
    for (let i = 0; i < 4; i++) window.setTimeout(() => sound.play("drip", { gain: LOUD * (0.1), pitch: 0.6 + i * 0.2, pan }), i * 70);
  },

  // The Current setting moved, to strength (0 to 2.5).
  current(strength: number) {
    sound.play("plop", { gain: LOUD * (0.1), pitch: 0.6 + (strength / 2.5) * 1.4, gap: 0.08 });
  }
};

// Whether a kelp is held just now, so that letting go is not also taken for a tap.
export const holding = { on: false, at: 0 };
