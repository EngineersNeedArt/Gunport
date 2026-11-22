// cannon.js -- the laser cannon above the gunner's head.
//
// One body model and four copies of a barrel model, in "gun space": the eye at
// the origin, +x right, +y up, +z forward along the aim (see tools/make-cannon.mjs,
// which builds the models). The cannon turns and tilts with the aim, so it holds
// still on screen and its muzzles stay lined up with the crosshair; only the
// barrels move, kicking back when they fire and easing forward again.
//
// The barrels are mounted in a square on the body's front. The guns fire them in
// pairs, top then bottom (see guns.js), from the muzzle positions given here.

import { modelFromJSON } from './renderer.js';

const BARREL_SPACING = [0.24, 0.15];	// half the gap between barrels: [across, up and down]
// Recoil: each barrel slides straight back along its length (toward the gunner,
// away from the shot), fast, then returns slowly. The same pair fires again
// every 0.28 s, so SNAP_TIME + RETURN_TIME should stay under that.
const RECOIL = 0.9;					// how far a barrel slides back when it fires
const SNAP_TIME = 0.03;				// seconds to slam back (about two frames)
const RETURN_TIME = 0.22;			// seconds to slide forward again

export class Cannon {
	#body;
	#barrels = [];		// { model, mount: [x, y, z], offset, from, time } -- see update()
	#length;			// barrel length, from its model

	/**
	 * @param {object} bodyJSON - models/cannon-body.json
	 * @param {object} barrelJSON - models/cannon-barrel.json
	 * @param {object} gunFrame - Model3D parent: gun space to the screen.
	 */
	constructor(bodyJSON, barrelJSON, gunFrame) {
		this.#body = modelFromJSON(bodyJSON, gunFrame);
		this.#length = Math.max(...barrelJSON.vertices.map((v) => v[2]));

		// Barrel roots sit just inside the body's front face.
		const bodyFront = bodyJSON.z + Math.max(...bodyJSON.vertices.map((v) => v[2]));
		const [across, upDown] = BARREL_SPACING;
		// Order matters: top pair, then bottom pair, each left then right (as guns.js fires them).
		for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
			const mount = [bodyJSON.x + sx * across, bodyJSON.y + sy * upDown, bodyFront - 0.1];
			this.#barrels.push({ model: modelFromJSON(barrelJSON, gunFrame), mount, offset: 0, from: 0, time: Infinity });
		}
		this.update(0);
	}

	/** Muzzle positions in gun space, as pairs in firing order: [top pair, bottom pair]. */
	get muzzlePairs() {
		const muzzles = this.#barrels.map(({ mount }) => [mount[0], mount[1], mount[2] + this.#length]);
		return [[muzzles[0], muzzles[1]], [muzzles[2], muzzles[3]]];
	}

	/** Kick back the barrels of one pair (0 = top, 1 = bottom). */
	recoil(pairIndex) {
		for (const barrel of [this.#barrels[pairIndex * 2], this.#barrels[pairIndex * 2 + 1]]) {
			barrel.from = barrel.offset;	// snap from wherever it is now, if still returning
			barrel.time = 0;
		}
	}

	update(dt) {
		for (const barrel of this.#barrels) {
			barrel.time += dt;
			barrel.offset = recoilOffset(barrel.time, barrel.from);
			const [x, y, z] = barrel.mount;
			barrel.model.x = x;
			barrel.model.y = y;
			barrel.model.z = z - barrel.offset;	// -z: back toward the gunner
		}
	}

	get models() {
		return [this.#body, ...this.#barrels.map((barrel) => barrel.model)];
	}
}

// How far back a barrel is, `time` seconds after firing, having started from `from`.
function recoilOffset(time, from) {
	if (time < SNAP_TIME) {
		// Slam back, decelerating into the end of the stroke.
		const t = time / SNAP_TIME;
		return from + (RECOIL - from) * (1 - (1 - t) * (1 - t));
	}
	const t = (time - SNAP_TIME) / RETURN_TIME;
	if (t >= 1) {
		return 0;
	}
	// Slide forward: easing in and out, so it gathers speed then settles home.
	return RECOIL * (1 - t * t * (3 - 2 * t));
}
