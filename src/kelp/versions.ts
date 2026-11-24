// The look of the sea: the light coming down through the surface, the colour and clarity of the water, the swell, and
// what swims in it. One sea now; the others tried are shelved in the notes.

export type Version = "forest";

export type School = {
  kind: "sardine" | "garibaldi" | "bass" | "chromis" | "tang" | "clown" | "parrot" | "yellowtail" | "cod" | "jack" | "mahi" | "seabass" | "shark" | "farshark" | "farjack";
  count: number;
};

export type Look = {
  label: string;
  swatch: string[];
  // The water looking up toward the surface, and looking down into the deep.
  shallow: string;
  deep: string;
  // The sun (or moon): its colour, strength and bearing in degrees.
  sun: string;
  power: number;
  bearing: number;
  // How high the sun is drawn under water, in degrees, lower than the surface would really bend it to.
  seen?: number;
  // How fast the water swallows light, per metre, and how much more it takes the reds than the blues.
  murk: number;
  absorb: [number, number, number];
  // Light wavering across everything: how bright, how big the cells are in metres, and how fast they move.
  caustics: number;
  cell: number;
  flicker: number;
  // Shafts of light down from the surface.
  shafts: number;
  // The swell: how high the waves are in metres and their period in seconds, and the way the steady current runs (its speed is the
  // visitor's Current setting).
  swell: number;
  period: number;
  current: [number, number];
  // The kelp's blades and stems.
  blade: string;
  stipe: string;
  floor: "rocky" | "coral";
  sand: string;
  schools: School[];
  jellies: number;
  // Specks in the water, and whether they glow when stirred.
  snow: number;
  glow: number;
  exposure: number;
  bloom: number;
};

export const LOOKS: Record<Version, Look> = {
  forest: {
    label: "Kelp forest",
    swatch: ["#9a7a2a", "#2d7f7a"],
    shallow: "#5fb3a4",
    deep: "#0a2730",
    sun: "#fff3d6",
    power: 3.2,
    bearing: -60,
    seen: 34,
    murk: 0.05,
    absorb: [2.4, 1, 0.85],
    caustics: 1.1,
    cell: 1.7,
    flicker: 1,
    shafts: 1.5,
    swell: 0.55,
    period: 9,
    current: [0.05, 0.02],
    blade: "#8a6a22",
    stipe: "#5a4518",
    floor: "rocky",
    sand: "#a8a090",
    schools: [
      { kind: "sardine", count: 80 },
      { kind: "sardine", count: 60 },
      { kind: "jack", count: 45 },
      { kind: "garibaldi", count: 6 },
      { kind: "bass", count: 8 },
      { kind: "yellowtail", count: 8 },
      { kind: "yellowtail", count: 6 },
      { kind: "seabass", count: 3 },
      { kind: "shark", count: 3 },
      { kind: "farshark", count: 2 },
      { kind: "farjack", count: 40 }
    ],
    jellies: 0,
    snow: 1,
    glow: 0,
    exposure: 1.05,
    bloom: 0.35
  }
};

export const KINDS = Object.keys(LOOKS) as Version[];
export const VERSIONS = KINDS.map((v) => ({ value: v, label: LOOKS[v].label, swatch: LOOKS[v].swatch }));
