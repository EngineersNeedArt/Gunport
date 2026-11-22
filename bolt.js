// bolt.js -- a laser bolt in flight, ours or the enemy's.
//
// A bolt flies in a straight line at a fixed speed and is done once it has gone
// its range. It is drawn as two Phosphor3D line models (a two-vertex face): a
// wide, dim glow with a narrow, bright core on top. Because they are ordinary
// models they depth-sort with the fighters, passing in front of or behind them.
//
// Hit testing uses the whole stretch the bolt's head covered since last frame,
// since a bolt moves further per frame than a fighter is wide.
//
// World coordinates match the turret: +x right, +y up, +z straight out.

import { Model3D } from '../Phosphor3D/model3d.js';

export class Bolt {
	travelled = 0;
	spent = false;		// set when it hits something

	/**
	 * @param {object} options
	 * @param {number[]} options.origin - where it starts (world).
	 * @param {number[]} options.direction - unit vector it flies along.
	 * @param {object} options.style - { speed, length, range, core, glow } (colours as CSS strings).
	 * @param {object} options.frame - Model3D parent that applies the turret's view.
	 */
	constructor({ origin, direction, style, frame }) {
		this.origin = origin;
		this.direction = direction;
		this.style = style;
		this.head = origin;			// where the front of the bolt is now
		this.previousHead = origin;	// ...and was last frame
		this.glow = lineModel(style.glow, frame);
		this.core = lineModel(style.core, frame);
		this.#place();
	}

	update(dt) {
		this.travelled += this.style.speed * dt;
		this.#place();
	}

	/** Gone out of range, or used up on a hit. */
	get done() {
		return this.spent || this.travelled >= this.style.range;
	}

	/** Did the head pass within `radius` of `center` since last frame? */
	passedWithin(center, radius) {
		return segmentHitsSphere(this.previousHead, this.head, center, radius);
	}

	/** Glow first, then the core on top. */
	get models() {
		return [this.glow, this.core];
	}

	// Update the line ends. The tail grows out of the muzzle for the first
	// `length` units, so a new bolt never reaches back behind the gun.
	#place() {
		const head = add(this.origin, scale(this.direction, this.travelled));
		const tail = add(this.origin, scale(this.direction, Math.max(0, this.travelled - this.style.length)));
		this.previousHead = this.head;
		this.head = head;
		for (const model of [this.glow, this.core]) {
			model.vertices[0] = [...tail, 1];
			model.vertices[1] = [...head, 1];
		}
		// Thicker near the turret (the origin, where the camera is), thinner far away.
		const width = Math.max(1, Math.min(5, 60 / Math.max(length(head), 1)));
		this.core.lineWidth = width;
		this.glow.lineWidth = width * 3;
	}
}

function lineModel(color, frame) {
	const model = new Model3D();
	model.vertices = [[0, 0, 0, 1], [0, 0, 0, 1]];
	model.faces = [[0, 1]];	// a two-vertex face: Phosphor3D strokes it as a line
	model.stroke = color;
	model.fill = null;
	model.parent = frame;
	return model;
}

// --- Vector helpers (shared with guns.js and enemyfire.js) ------------------

/** Does the line segment a-b pass within `radius` of `center`? */
export function segmentHitsSphere(a, b, center, radius) {
	const ab = sub(b, a);
	const lengthSquared = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
	const ac = sub(center, a);
	// How far along a-b the closest point lies, clamped to the segment.
	const t = lengthSquared > 0
		? Math.max(0, Math.min(1, (ac[0] * ab[0] + ac[1] * ab[1] + ac[2] * ab[2]) / lengthSquared))
		: 0;
	const closest = add(a, scale(ab, t));
	return length(sub(center, closest)) <= radius;
}

export function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

export function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v) {
	const len = length(v) || 1;
	return [v[0] / len, v[1] / len, v[2] / len];
}

export function cross(a, b) {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
