// Lehmer (Park–Miller) pseudo-random generator: a seeded, repeatable stream of numbers in [0, 1).
// Every procedural thing in the scene is grown from one of these, so the forest is the same on every visit.
export function lehmer(seed: number) {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state += 2147483646;
  // Warm it up so nearby seeds do not start out with nearby values.
  for (let i = 0; i < 3; i++) state = (state * 48271) % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
