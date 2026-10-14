import MersenneTwister from "mersenne-twister";

/**
 * Jazzicon, MetaMask's address identicon, as data rather than DOM: the
 * background colour and the three rotated squares laid over it. A port of
 * @metamask/jazzicon 2.0.0 that draws exactly what it draws (checked
 * against it for thousands of addresses), without the old `color` library
 * it pulls in. MetaMask seeds it with the address's first four bytes.
 */

const PALETTE = [
  "#01888C", // teal
  "#FC7500", // bright orange
  "#034F5D", // dark teal
  "#F73F01", // orangered
  "#FC1960", // magenta
  "#C7144C", // raspberry
  "#F3C100", // goldenrod
  "#1598F2", // lightning blue
  "#2465E1", // sail blue
  "#F19E02", // gold
];
const SHAPES = 4;
const WOBBLE = 30;

export type Jazzicon = {
  background: string;
  shapes: { transform: string; fill: string }[];
};

/** jazzicon lays out the identicon for seed at diameter pixels. */
export function jazzicon(diameter: number, seed: number): Jazzicon {
  const generator = new MersenneTwister(seed);
  const amount = generator.random() * 30 - WOBBLE / 2;
  const remaining = PALETTE.map((hex) => rotateHue(hex, amount));

  const pick = () => {
    generator.random(); // drawn and unused upstream; kept so the sequence matches
    const i = Math.floor(remaining.length * generator.random());
    return remaining.splice(i, 1)[0];
  };

  const background = pick();
  const total = SHAPES - 1;
  const center = diameter / 2;
  const shapes: Jazzicon["shapes"] = [];
  for (let i = 0; i < total; i++) {
    const firstRot = generator.random();
    const angle = Math.PI * 2 * firstRot;
    const velocity = (diameter / total) * generator.random() + (i * diameter) / total;
    const tx = Math.cos(angle) * velocity;
    const ty = Math.sin(angle) * velocity;
    const secondRot = generator.random();
    const rot = firstRot * 360 + secondRot * 180;
    shapes.push({
      transform: `translate(${tx} ${ty}) rotate(${rot.toFixed(1)} ${center} ${center})`,
      fill: pick(),
    });
  }
  return { background, shapes };
}

/** jazzicon's seed for an address, as MetaMask derives it: its first four bytes. */
export function addressSeed(address: string): number {
  return parseInt(address.slice(2, 10), 16);
}

// The hue rotation of `color` 0.11, step for step and with its rounding:
// hex to RGB, to HSL rounded, the hue turned and rounded, back to RGB
// rounded, to hex in capitals.

function rotateHue(hex: string, degrees: number): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [h, s, l] = rgbToHsl(rgb).map(Math.round);
  let hue = (h + degrees) % 360;
  if (hue < 0) hue += 360;
  const out = hslToRgb([Math.round(Math.max(0, Math.min(360, hue))), s, l]).map((v) =>
    Math.round(Math.max(0, Math.min(255, Math.round(v)))),
  );
  return "#" + out.map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join("");
}

function rgbToHsl([r8, g8, b8]: number[]): number[] {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const delta = max - min;
  let h = 0;
  if (max === min) h = 0;
  else if (r === max) h = (g - b) / delta;
  else if (g === max) h = 2 + (b - r) / delta;
  else if (b === max) h = 4 + (r - g) / delta;
  h = Math.min(h * 60, 360);
  if (h < 0) h += 360;
  const l = (min + max) / 2;
  const s = max === min ? 0 : l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
  return [h, s * 100, l * 100];
}

function hslToRgb([h360, s100, l100]: number[]): number[] {
  const h = h360 / 360;
  const s = s100 / 100;
  const l = l100 / 100;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const t2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const t1 = 2 * l - t2;
  return [0, 1, 2].map((i) => {
    let t3 = h + (1 / 3) * -(i - 1);
    if (t3 < 0) t3++;
    if (t3 > 1) t3--;
    let val: number;
    if (6 * t3 < 1) val = t1 + (t2 - t1) * 6 * t3;
    else if (2 * t3 < 1) val = t2;
    else if (3 * t3 < 2) val = t1 + (t2 - t1) * (2 / 3 - t3) * 6;
    else val = t1;
    return val * 255;
  });
}
