/* ============================================================
   Shared constants for the OptoLabs ray-tracing engine
   ============================================================ */

export const MEDIA = {
  vacuum:  { label: 'Vacuum',              A: 1.0000, B: 0.0000 },
  air:     { label: 'Air',                 A: 1.00029, B: 0.0000 },
  water:   { label: 'Water',               A: 1.3230, B: 0.0032 },
  glass:   { label: 'Crown glass (BK7)',   A: 1.5046, B: 0.0042 },
  flint:   { label: 'Flint glass (dense)', A: 1.6000, B: 0.0120 },
  diamond: { label: 'Diamond',             A: 2.3800, B: 0.0080 },
};

export function nOf(medium, wlNm) {
  const um = wlNm / 1000;
  return medium.A + medium.B / (um * um);
}

/* Ray-tracing limits */
export const MAX_DEPTH     = 22;
export const MAX_TRACE_SEGS = 500000;
export const MAX_PROC      = 3000000;
export const MIN_INT       = 0.0025;
export const HARD_RAY_CAP  = 200000;
export const SCREEN_RES    = 256;

/* Color filter transmission functions */
export const FILTERS = {
  red:   wl => wl > 585 ? 0.95 : Math.max(0, 0.95 * (1 - (585 - wl) / 70)),
  green: wl => 0.95 * Math.exp(-Math.pow((wl - 535) / 48, 2)),
  blue:  wl => wl < 487 ? 0.95 : Math.max(0, 0.95 * (1 - (wl - 487) / 70)),
};

/* Wavelength to RGB */
export function wavelengthToRGB(wl) {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1; }
  else if (wl < 490) { g = (wl - 440) / 50; b = 1; }
  else if (wl < 510) { g = 1; b = -(wl - 510) / 20; }
  else if (wl < 580) { r = (wl - 510) / 70; g = 1; }
  else if (wl < 645) { r = 1; g = -(wl - 645) / 65; }
  else if (wl <= 780) { r = 1; }
  let f = 1;
  if (wl >= 380 && wl < 420) f = 0.35 + 0.65 * (wl - 380) / 40;
  else if (wl > 700 && wl <= 780) f = 0.35 + 0.65 * (780 - wl) / 80;
  const ga = 0.85;
  return [Math.pow(r * f, ga), Math.pow(g * f, ga), Math.pow(b * f, ga)];
}

/* Ray-count log scale helpers */
export function rayCountFromSlider(logVal) {
  if (logVal <= 0) return 1;
  const v = Math.pow(10, logVal / 100);
  return Math.max(1, Math.round(v));
}

export function sliderFromRayCount(n) {
  if (n <= 1) return 0;
  return Math.round(Math.log10(n) * 100);
}

export function formatRayCount(n) {
  if (n < 1000) return n.toString();
  if (n < 1e6) return n.toLocaleString();
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.0+$/, '') + 'M';
  return (n / 1e9).toFixed(2).replace(/\.0+$/, '') + 'B';
}

/* Model description notes */
export const MODEL_NOTES = {
  ray: 'Single idealized line — no width, no wave nature. Pure geometric optics.',
  beam: 'Parallel rays with finite width. Width from beam radius & ray count.',
  wave: 'Electric field oscillates perpendicular to the path (E-field shown as a sine).',
  plane: 'Straight ray with perpendicular wavefronts — equal phase fronts across the beam.',
  spherical: 'Diverging rays from a point source, with curved wavefronts along each ray.',
  gaussian: 'Brightness-weighted beam — rays near the axis carry more power.',
  torch: 'Real-world white torch — the light is rendered as a soft volumetric glow. ' +
    'Beam angle sets the cone. Brightness sets the output power.'
};

/* Component type definitions (shared between client and server for params) */
export const COMPONENT_DEFAULTS = {
  mirror:       { reflectivity: 0.95 },
  curvedmirror: { aperture: 0.85, curvature: 2.6, reflectivity: 0.95 },
  beamsplitter: { reflectivity: 0.5 },
  polarizer:    { angle: 0 },
  halfwave:     { angle: 0 },
  quarterwave:  { angle: 0 },
  lens:         { aperture: 0.7, curvature: 2.5, material: 'glass' },
  prism:        { material: 'flint' },
  block:        { size: 1.6, material: 'glass' },
  filter:       { color: 'red' },
  screen:       { gain: 1.0 },
  detector:     { gain: 1.0 },
};
