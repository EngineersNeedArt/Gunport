// Usage: node tools/make-bezel.mjs   (rewrites models/bezel.json)
//
// Starter bezel: a continuous octagonal ring around the line of sight, with 8
// struts growing out of its outer edge and running past the edge of the screen.
//
// Every polygon is convex and lies in one plane. Where pieces butt together, the
// shared edges are listed in "hiddenEdges" (Phosphor3D faces2 format) so they are
// filled but not stroked -- the outline then traces only the true silhouette.
// Front faces wind counter-clockwise as seen by the gunner.
import { writeFileSync } from 'fs';

const Z = 2.0;                   // distance of the bezel plane from the eye
const R1 = 0.42, R2 = 0.47;      // ring inner / outer circumradius
const W = 0.035, R_TIP = 4;      // strut width; struts run out to R_TIP (off screen)
const N = 8, A0 = Math.PI / 8;   // octagon with flat edges top/bottom/left/right
// Outline colour. Phosphor green at 25%. Set to null for a pure black silhouette
// (Phosphor3D skips stroking when a model's stroke is null).
const STROKE = 'rgb(50, 50, 50)';    // dim grey (same brightness as the old 25% green)
const FILL = 'rgb(7, 7, 7)';          // near black

const rnd = (n) => Math.round(n * 1000) / 1000;
const verts = [], faces = [];
const add = ([x, y]) => { verts.push([rnd(x), rnd(y), Z, 1]); return verts.length - 1; };
const ang = (k) => A0 + k * 2 * Math.PI / N;
const corner = (rad, k) => [rad * Math.cos(ang(k)), rad * Math.sin(ang(k))];

// Where line p + t*d meets the line through a and b.
function hit(p, d, a, b) {
  const e = [b[0] - a[0], b[1] - a[1]];
  const t = ((a[0] - p[0]) * e[1] - (a[1] - p[1]) * e[0]) / (d[0] * e[1] - d[1] * e[0]);
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

const inner = [], outer = [];
for (let k = 0; k < N; k++) {
  inner.push(add(corner(R1, k)));
  outer.push(add(corner(R2, k)));
}

// Strut k sits on ring corner k. Its sides meet the ring's outer edge either side of the corner.
const strut = [];
for (let k = 0; k < N; k++) {
  const d = [Math.cos(ang(k)), Math.sin(ang(k))], n = [-d[1], d[0]];   // n = to the CCW side
  const R = [-n[0] * W / 2, -n[1] * W / 2], L = [n[0] * W / 2, n[1] * W / 2];
  strut.push({
    baseR: add(hit(R, d, corner(R2, k - 1), corner(R2, k))),
    baseL: add(hit(L, d, corner(R2, k), corner(R2, k + 1))),
    tipR: add([R[0] + d[0] * R_TIP, R[1] + d[1] * R_TIP]),
    tipL: add([L[0] + d[0] * R_TIP, L[1] + d[1] * R_TIP]),
  });
}

// Ring segment k, corner k to corner k+1. The outer edge is split where the struts
// land so the bit under each strut's foot can be hidden.
//   edges: 0 seam | 1 under strut k | 2 outer | 3 under strut k+1 | 4 seam | 5 inner (window)
for (let k = 0; k < N; k++) {
  const k1 = (k + 1) % N;
  const v = [inner[k], outer[k], strut[k].baseL, strut[k1].baseR, outer[k1], inner[k1]];
  faces.push({ vertices: [...v, v[0]], hiddenEdges: [0, 1, 3, 4] });
}

// Struts: base-right -> tip-right -> tip-left -> base-left. Edge 3 (the base, where
// the strut overlaps the ring) is hidden.
for (const s of strut) {
  const v = [s.baseR, s.tipR, s.tipL, s.baseL];
  faces.push({ vertices: [...v, v[0]], hiddenEdges: [3] });
}

const lines = [
  '{',
  '  "name": "bezel (starter)",',
  '  "x": 0, "y": 0, "z": 0, "scale": 1,',
  '  "xRot": 0, "yRot": 0, "zRot": 0,',
  `  "stroke": ${JSON.stringify(STROKE)},`,
  `  "fill": "${FILL}",`,
  '  "lineWidth": 2,',
  '  "parent": null,',
  '  "vertices": [',
  verts.map((v) => `    [ ${v.join(', ')} ]`).join(',\n'),
  '  ],',
  '  "faces2": [',
  faces.map((f) => `    { "vertices": [ ${f.vertices.join(', ')} ], "hiddenEdges": [ ${f.hiddenEdges.join(', ')} ] }`).join(',\n'),
  '  ]',
  '}',
];
writeFileSync(new URL('../models/bezel.json', import.meta.url), lines.join('\n') + '\n');
console.log(`${verts.length} vertices, ${faces.length} faces`);
