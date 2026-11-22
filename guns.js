// guns.js -- the turret's cannon fire.
//
// Four muzzles sit in a square around the line of sight. They fire in pairs,
// alternating: top pair, bottom pair, top pair... Each bolt is angled slightly
// inward so all four streams converge on the crosshair CONVERGE units out.
//
// Bolts are not instant: they fly at BOLT_SPEED and are dropped once they pass
// MAX_RANGE. Each bolt is drawn as two Phosphor3D line models (a two-vertex
// face): a wide, dim glow with a narrow, bright core on top. Because they are
// ordinary models they depth-sort with the fighters, passing in front of or
// behind them correctly.
//
// World coordinates match the turret: +x right, +y up, +z ahead at heading 0.

import { Model3D } from '../Phosphor3D/model3d.js';

const BOLT_SPEED = 160;			// world units per second
const BOLT_LENGTH = 6;			// world units, nose to tail
const MAX_RANGE = 160;			// dropped beyond this distance
const FIRE_INTERVAL = 0.14;		// seconds between pairs while the trigger is held
const CONVERGE = 45;			// distance at which the four streams meet

// Muzzle offsets from the line of sight: [right, up], plus how far ahead they sit.
const MUZZLE_RIGHT = 1.1;
const MUZZLE_UP = 0.7;
const MUZZLE_AHEAD = 1.0;
const PAIRS = [
	[[-MUZZLE_RIGHT, MUZZLE_UP], [MUZZLE_RIGHT, MUZZLE_UP]],		// top pair
	[[-MUZZLE_RIGHT, -MUZZLE_UP], [MUZZLE_RIGHT, -MUZZLE_UP]],	// bottom pair
];

const CORE_COLOR = 'rgb(255, 190, 90)';
const GLOW_COLOR = 'rgba(255, 110, 20, 0.35)';

export class Guns {
	firing = false;		// trigger held?
	bolts = [];			// { origin, direction, travelled, core, glow }

	#cooldown = 0;		// seconds until the next pair may fire
	#nextPair = 0;		// index into PAIRS

	/** @param {object} worldFrame - Model3D parent that applies the turret's view. */
	constructor(worldFrame) {
		this.worldFrame = worldFrame;
	}

	update(dt, turret) {
		// Fire as many pairs as the elapsed time allows (normally zero or one).
		this.#cooldown -= dt;
		if (this.firing) {
			while (this.#cooldown <= 0) {
				this.#firePair(turret);
				this.#cooldown += FIRE_INTERVAL;
			}
		} else if (this.#cooldown < 0) {
			this.#cooldown = 0;	// ready to fire the moment the trigger is pulled
		}

		// Move bolts; drop the ones that have gone out of range.
		for (const bolt of this.bolts) {
			bolt.travelled += BOLT_SPEED * dt;
			this.#placeBolt(bolt);
		}
		this.bolts = this.bolts.filter((bolt) => bolt.travelled < MAX_RANGE);
	}

	/**
	 * Test this frame's bolt movement against targets, each { position, radius }.
	 * Uses the whole stretch a bolt's head covered since last frame (a bolt moves
	 * ~2.7 units per frame, more than a fighter is wide, so testing only where it
	 * ends up would let it skip straight through). A bolt that hits is used up.
	 * @returns {Array} the target hit by each bolt that hit (a target may repeat).
	 */
	hitTest(targets) {
		const hits = [];
		for (const bolt of this.bolts) {
			for (const target of targets) {
				if (segmentHitsSphere(bolt.previousHead, bolt.head, target.position, target.radius)) {
					bolt.spent = true;
					hits.push(target);
					break;
				}
			}
		}
		this.bolts = this.bolts.filter((bolt) => !bolt.spent);
		return hits;
	}

	/** The models to draw this frame (two per bolt: glow, then core on top). */
	get models() {
		const models = [];
		for (const bolt of this.bolts) {
			models.push(bolt.glow, bolt.core);
		}
		return models;
	}

	#firePair(turret) {
		const { forward, right, up } = aimAxes(turret);
		const aimPoint = scale(forward, CONVERGE);
		for (const [r, u] of PAIRS[this.#nextPair]) {
			const origin = add(add(scale(right, r), scale(up, u)), scale(forward, MUZZLE_AHEAD));
			const bolt = {
				origin,
				direction: normalize(sub(aimPoint, origin)),
				travelled: 0,
				head: origin,			// where the front of the bolt is now
				previousHead: origin,	// ...and was last frame (for hit testing)
				spent: false,
				glow: this.#lineModel(GLOW_COLOR),
				core: this.#lineModel(CORE_COLOR),
			};
			this.#placeBolt(bolt);
			this.bolts.push(bolt);
		}
		this.#nextPair = (this.#nextPair + 1) % PAIRS.length;
	}

	#lineModel(color) {
		const model = new Model3D();
		model.vertices = [[0, 0, 0, 1], [0, 0, 0, 1]];
		model.faces = [[0, 1]];	// a two-vertex face: Phosphor3D strokes it as a line
		model.stroke = color;
		model.fill = null;
		model.parent = this.worldFrame;
		return model;
	}

	// Update a bolt's line ends. The tail grows out of the muzzle for the first
	// BOLT_LENGTH units, so a new bolt never reaches back behind the gun.
	#placeBolt(bolt) {
		const head = add(bolt.origin, scale(bolt.direction, bolt.travelled));
		const tail = add(bolt.origin, scale(bolt.direction, Math.max(0, bolt.travelled - BOLT_LENGTH)));
		bolt.previousHead = bolt.head;
		bolt.head = head;
		for (const model of [bolt.glow, bolt.core]) {
			model.vertices[0] = [...tail, 1];
			model.vertices[1] = [...head, 1];
		}
		// Thicker up close, thinner far away (the turret is at the origin).
		const width = Math.max(1, Math.min(5, 60 / Math.max(length(head), 1)));
		bolt.core.lineWidth = width;
		bolt.glow.lineWidth = width * 3;
	}
}

// The turret's aim as three unit vectors in world space.
function aimAxes(turret) {
	const cy = Math.cos(turret.yaw), sy = Math.sin(turret.yaw);
	const cp = Math.cos(turret.pitch), sp = Math.sin(turret.pitch);
	return {
		forward: [sy * cp, sp, cy * cp],
		right: [cy, 0, -sy],
		up: [-sy * sp, cp, -cy * sp],
	};
}

// Does the line segment a-b pass within `radius` of `center`?
function segmentHitsSphere(a, b, center, radius) {
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

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
	const len = length(v) || 1;
	return [v[0] / len, v[1] / len, v[2] / len];
}
