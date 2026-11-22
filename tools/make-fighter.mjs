// Usage: node tools/make-fighter.mjs   (rewrites models/fighter.json)
//
// Enemy fighter: a round cockpit ball between two upright hexagonal wing panels,
// each on a short square strut. The nose (the octagonal front window) points
// along +z, the direction it flies.
//
//   - ball:    one 20-sided BILLBOARD face (always turned to the camera), so a
//              single polygon reads as a sphere from every angle;
//   - window:  an ordinary flat octagon on the front of the ball, so it
//              foreshortens as the fighter turns and is culled when facing away;
//              it has its own darker blue fill (a per-face "fill" override);
//   - panels:  DOUBLE-SIDED hexagons (seen from both sides), with an inner
//              hexagon subface as panel detail;
//   - struts:  four-sided boxes (no end caps -- they're buried in ball and panel).
//
// One-sided faces are oriented automatically: in this engine a face is front-facing
// when the plain cross product (b - a) x (c - a) of its first three vertices points
// INTO the part it belongs to.
import { writeFileSync } from 'fs';

const BALL_RADIUS = 0.8;
const BALL_SIDES = 20;
const WINDOW_RADIUS = 0.36;			// the window octagon, set into the front of the ball
const WINDOW_Z = Math.sqrt(BALL_RADIUS ** 2 - WINDOW_RADIUS ** 2) + 0.02;
const PANEL_X = 1.8;				// wing panels' distance out from the centre
const PANEL_RADIUS = 1.35;			// centre to corner; corners at top and bottom
const PANEL_STRETCH = 0.8;			// fore-aft squash, for a taller, narrower panel
const PANEL_INSET = 0.55;			// inner detail hexagon, as a fraction of the panel
const STRUT_HALF = 0.14;			// strut cross-section, half width
const STRUT_START = BALL_RADIUS * 0.97;	// just inside the ball, so struts never overlap its face

const STROKE = 'rgb(165, 178, 200)';		// very desaturated blue, nearly grey
const FILL = 'rgb(13, 15, 19)';			// near black, faintly blue
const WINDOW_FILL = 'rgb(24, 32, 52)';	// deeper, darker blue for the front window

const vertices = [];
const faces2 = [];
const subfaces = [];

const addVertex = (v) => vertices.push(v) - 1;
const close = (ids) => [...ids, ids[0]];

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const centroid = (ids) => [0, 1, 2].map((k) => ids.reduce((s, i) => s + vertices[i][k], 0) / ids.length);

// Wind a face so it's front-facing when seen from outside, i.e. from away from `inside`.
function orient(ids, inside) {
	const [a, b, c] = ids.map((i) => vertices[i]);
	const n = cross(sub(b, a), sub(c, a));
	return dot(n, sub(inside, centroid(ids))) > 0 ? ids : [...ids].reverse();
}

// Ball: a circle in the x-y plane, made a billboard.
const ball = [];
for (let i = 0; i < BALL_SIDES; i++) {
	const a = (i / BALL_SIDES) * 2 * Math.PI;
	ball.push(addVertex([BALL_RADIUS * Math.cos(a), BALL_RADIUS * Math.sin(a), 0]));
}
faces2.push({ vertices: close(ball), billboard: true });

// Window: an octagon on the front of the ball.
const window = [];
for (let i = 0; i < 8; i++) {
	const a = ((i + 0.5) / 8) * 2 * Math.PI;
	window.push(addVertex([WINDOW_RADIUS * Math.cos(a), WINDOW_RADIUS * Math.sin(a), WINDOW_Z]));
}
faces2.push({ vertices: close(orient(window, [0, 0, 0])), fill: WINDOW_FILL });

for (const side of [-1, 1]) {
	// Strut: a square box along x from inside the ball out to the panel.
	const s = STRUT_HALF;
	const [x0, x1] = [side * STRUT_START, side * PANEL_X];
	const corners = [[s, s], [-s, s], [-s, -s], [s, -s]];	// [y, z]
	const near = corners.map(([y, z]) => addVertex([x0, y, z]));
	const far = corners.map(([y, z]) => addVertex([x1, y, z]));
	const strutMiddle = [(x0 + x1) / 2, 0, 0];
	for (let i = 0; i < 4; i++) {
		const j = (i + 1) % 4;
		faces2.push({ vertices: close(orient([near[i], near[j], far[j], far[i]], strutMiddle)) });
	}

	// Panel: an upright hexagon in the y-z plane, double-sided, corners top and bottom.
	const hexagon = (scale) => {
		const ids = [];
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * 2 * Math.PI;
			ids.push(addVertex([
				side * PANEL_X,
				scale * PANEL_RADIUS * Math.cos(a),
				scale * PANEL_RADIUS * Math.sin(a) * PANEL_STRETCH,
			]));
		}
		return close(ids);
	};
	const panelIndex = faces2.push({ vertices: hexagon(1), doublesided: true }) - 1;
	subfaces.push({ parent: panelIndex, vertices: hexagon(PANEL_INSET) });
}

const round = (n) => Math.round(n * 1e4) / 1e4;
const json = {
	name: 'fighter (ball and panels)',
	x: 0, y: 0, z: 0, scale: 1, xRot: 0, yRot: 0, zRot: 0,
	stroke: STROKE, fill: FILL, lineWidth: 1.5, parent: null,
	vertices: vertices.map((v) => [...v.map(round), 1]),
	faces2,
	subfaces,
};
const text = JSON.stringify(json, null, '\t')
	.replace(/\[\s+([-\d.]+),\s+([-\d.]+),\s+([-\d.]+),\s+([-\d.]+)\s+\]/g, (m) => m.replace(/\s+/g, ' '))
	.replace(/("vertices": )\[\s+([\d,\s]+?)\s+\]/g, (m, key, list) => `${key}[${list.replace(/\s+/g, ' ')}]`)
	.replace(/("hiddenEdges": )\[\s+([\d,\s]+?)\s+\]/g, (m, key, list) => `${key}[${list.replace(/\s+/g, ' ')}]`);
writeFileSync(new URL('../models/fighter.json', import.meta.url), text + '\n');
console.log(`${vertices.length} vertices, ${faces2.length} faces, ${subfaces.length} subfaces`);
