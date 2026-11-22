// Usage: node tools/make-cannon.mjs   (rewrites models/cannon-body.json and models/cannon-barrel.json)
//
// The laser cannon, in two models:
//   - body:   an elongated box with every edge chamfered (cut off at 45°), so it
//             has 6 face panels, 12 chamfer strips and 8 corner triangles;
//   - barrel: a six-sided prism, slightly tapered toward the muzzle, with its
//             root at the origin and the muzzle along +z. cannon.js places four
//             copies in a square on the body's front (and slides each back a
//             little when it fires).
//
// Coordinates are "gun space": the gunner's eye at the origin, +x right, +y up,
// +z forward along the aim. The body's own position is in its JSON (x, y, z):
// above the line of sight and a little ahead, so you look up at its underside
// with the barrels reaching forward over the top of the view.
//
// Faces are oriented automatically: in this engine a face is front-facing when
// the cross product (b - a) x (c - a) of its first three vertices points INTO
// the part.
import { writeFileSync } from 'fs';

// Body: centre and half-sizes in gun space, and how much each edge is cut back.
const BODY_CENTER = [0, 1.5, 3.8];
const BODY_HALF = [0.45, 0.3, 1.0];	// width, height, length (along the aim)
const CHAMFER = 0.1;

// Barrel: six sides, radius at the root and at the muzzle (corner radius), length.
const BARREL_SIDES = 6;
const BARREL_ROOT_RADIUS = 0.1;
const BARREL_MUZZLE_RADIUS = 0.075;
const BARREL_LENGTH = 6;

const STROKE = 'rgb(110, 110, 110)';
const FILL = 'rgb(16, 16, 16)';

// --- Helpers ----------------------------------------------------------------

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

// Wind face `ids` (into `vertices`) so it's front-facing from outside a convex part.
function orient(vertices, ids, inside) {
	const [a, b, c] = ids.map((i) => vertices[i]);
	const middle = [0, 1, 2].map((k) => ids.reduce((s, i) => s + vertices[i][k], 0) / ids.length);
	const n = cross(sub(b, a), sub(c, a));
	return dot(n, sub(inside, middle)) > 0 ? ids : [...ids].reverse();
}

function write(file, name, position, vertices, faces) {
	const round = (n) => Math.round(n * 1e4) / 1e4;
	const json = {
		name,
		x: position[0], y: position[1], z: position[2], scale: 1, xRot: 0, yRot: 0, zRot: 0,
		stroke: STROKE, fill: FILL, lineWidth: 1.5, parent: null,
		vertices: vertices.map((v) => [...v.map(round), 1]),
		faces: faces.map((f) => [...f, f[0]]),	// closed, so every edge is stroked
	};
	const text = JSON.stringify(json, null, '\t')
		.replace(/\[\s+([-\d.]+),\s+([-\d.]+),\s+([-\d.]+),\s+([-\d.]+)\s+\]/g, (m) => m.replace(/\s+/g, ' '))
		.replace(/\[\s+([\d,\s]+?)\s+\]/g, (m, list) => `[${list.replace(/\s+/g, ' ')}]`);
	writeFileSync(new URL(`../models/${file}`, import.meta.url), text + '\n');
	console.log(`${file}: ${vertices.length} vertices, ${faces.length} faces`);
}

// --- Body: a chamfered box --------------------------------------------------
// Each corner of the box is replaced by three vertices, one on each of the
// three faces meeting there, each pulled back from the corner by CHAMFER.
{
	const [a, b, c] = BODY_HALF;
	const t = CHAMFER;
	const vertices = [];
	const index = {};	// "sx,sy,sz,axis" -> vertex; axis is the face the vertex lies on
	for (const sx of [-1, 1]) {
		for (const sy of [-1, 1]) {
			for (const sz of [-1, 1]) {
				const corner = [
					[sx * a, sy * (b - t), sz * (c - t)],	// on the x face
					[sx * (a - t), sy * b, sz * (c - t)],	// on the y face
					[sx * (a - t), sy * (b - t), sz * c],	// on the z face
				];
				corner.forEach((v, axis) => {
					index[`${sx},${sy},${sz},${axis}`] = vertices.push(v) - 1;
				});
			}
		}
	}
	const at = (s, axis) => index[`${s[0]},${s[1]},${s[2]},${axis}`];
	const faces = [];
	const signs = [-1, 1];

	// Face panels: on each face, the four corners' vertices that lie on it.
	for (let axis = 0; axis < 3; axis++) {
		const [u, v] = [0, 1, 2].filter((k) => k !== axis);
		for (const s of signs) {
			const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
				const sign = [0, 0, 0];
				sign[axis] = s;
				sign[u] = su;
				sign[v] = sv;
				return at(sign, axis);
			});
			faces.push(ring);
		}
	}
	// Chamfer strips: along each edge (parallel to `along`), between its two faces.
	for (let along = 0; along < 3; along++) {
		const [p, q] = [0, 1, 2].filter((k) => k !== along);
		for (const sp of signs) {
			for (const sq of signs) {
				const sign = (sAlong) => {
					const s = [0, 0, 0];
					s[along] = sAlong;
					s[p] = sp;
					s[q] = sq;
					return s;
				};
				faces.push([at(sign(-1), p), at(sign(1), p), at(sign(1), q), at(sign(-1), q)]);
			}
		}
	}
	// Corner triangles.
	for (const sx of signs) {
		for (const sy of signs) {
			for (const sz of signs) {
				faces.push([0, 1, 2].map((axis) => at([sx, sy, sz], axis)));
			}
		}
	}
	write('cannon-body.json', 'laser cannon body (chamfered box)', BODY_CENTER, vertices,
		faces.map((f) => orient(vertices, f, [0, 0, 0])));
}

// --- Barrel: a tapered six-sided prism --------------------------------------
{
	const vertices = [];
	const ring = (radius, z) => {
		const ids = [];
		for (let i = 0; i < BARREL_SIDES; i++) {
			const angle = (i / BARREL_SIDES) * 2 * Math.PI;	// corners at the sides, flats on top and bottom
			ids.push(vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), z]) - 1);
		}
		return ids;
	};
	const root = ring(BARREL_ROOT_RADIUS, 0);
	const muzzle = ring(BARREL_MUZZLE_RADIUS, BARREL_LENGTH);
	const faces = [];
	for (let i = 0; i < BARREL_SIDES; i++) {
		const j = (i + 1) % BARREL_SIDES;
		faces.push([root[i], root[j], muzzle[j], muzzle[i]]);
	}
	faces.push(muzzle);	// the muzzle end (the root end is buried in the body)
	const inside = [0, 0, BARREL_LENGTH / 2];
	write('cannon-barrel.json', 'laser cannon barrel (tapered hexagonal prism)', [0, 0, 0], vertices,
		faces.map((f) => orient(vertices, f, inside)));
}
