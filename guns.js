// guns.js -- the turret's cannon fire.
//
// Four muzzles (the cannon's barrel tips) fire in pairs, alternating: top pair,
// bottom pair, top pair... Each bolt is angled slightly so all four streams
// converge on the crosshair CONVERGE units out. Bolts (see bolt.js) fly at a
// finite speed and are dropped once out of range.
//
// World coordinates match the turret: +x right, +y up, +z straight out.

import { Bolt, add, sub, scale, normalize } from './bolt.js';

const FIRE_INTERVAL = 0.28;		// seconds between pairs while the trigger is held
const CONVERGE = 45;			// distance at which the four streams meet
const BOLT_STYLE = {
	speed: 160,					// world units per second
	length: 6,					// world units, nose to tail
	range: 160,					// dropped beyond this distance
	core: 'rgb(255, 190, 90)',
	glow: 'rgba(255, 110, 20, 0.35)',
};

// Default muzzle positions, until the cannon supplies its own (see muzzlePairs):
// [right, up, ahead] of the eye, as two pairs fired alternately.
const DEFAULT_MUZZLE_PAIRS = [
	[[-1.1, 0.7, 1.0], [1.1, 0.7, 1.0]],		// top pair
	[[-1.1, -0.7, 1.0], [1.1, -0.7, 1.0]],		// bottom pair
];

export class Guns {
	firing = false;		// trigger held?
	bolts = [];			// Bolt objects in flight

	// Muzzles as pairs of [right, up, ahead] from the eye, in firing order.
	muzzlePairs = DEFAULT_MUZZLE_PAIRS;
	// Called with the pair's index each time a pair fires (the cannon's recoil).
	onFire = null;

	#cooldown = 0;		// seconds until the next pair may fire
	#nextPair = 0;		// index into muzzlePairs

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
			bolt.update(dt);
		}
		this.bolts = this.bolts.filter((bolt) => !bolt.done);
	}

	/**
	 * Test this frame's bolt movement against targets, each { position, radius }.
	 * A bolt that hits is used up.
	 * @returns {Array} the target hit by each bolt that hit (a target may repeat).
	 */
	hitTest(targets) {
		const hits = [];
		for (const bolt of this.bolts) {
			for (const target of targets) {
				if (bolt.passedWithin(target.position, target.radius)) {
					bolt.spent = true;
					hits.push(target);
					break;
				}
			}
		}
		this.bolts = this.bolts.filter((bolt) => !bolt.done);
		return hits;
	}

	/** The models to draw this frame (two per bolt: glow, then core on top). */
	get models() {
		const models = [];
		for (const bolt of this.bolts) {
			models.push(...bolt.models);
		}
		return models;
	}

	#firePair(turret) {
		const { forward, right, up } = turret.axes();
		const aimPoint = scale(forward, CONVERGE);
		for (const [r, u, ahead] of this.muzzlePairs[this.#nextPair]) {
			const origin = add(add(scale(right, r), scale(up, u)), scale(forward, ahead));
			this.bolts.push(new Bolt({
				origin,
				direction: normalize(sub(aimPoint, origin)),
				style: BOLT_STYLE,
				frame: this.worldFrame,
			}));
		}
		this.onFire?.(this.#nextPair);
		this.#nextPair = (this.#nextPair + 1) % this.muzzlePairs.length;
	}
}
