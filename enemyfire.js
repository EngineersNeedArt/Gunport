// enemyfire.js -- the fighters shooting back.
//
// A fighter opens fire when its nose is pointed roughly at our ship and it's in
// range: a short burst of paired green bolts from just below its cockpit, then a
// pause before the next burst. Its aim isn't perfect: each pair is aimed at a
// random point up to MISS_SPREAD from the turret, and only those passing within
// SHIP_RADIUS hit the ship -- so about 3 in 8 hit, and the rest streak past.
//
// World coordinates match the turret: +x right, +y up, +z straight out, with
// the turret (and our ship) at the origin.

import { Bolt, add, sub, scale, length, normalize, cross } from './bolt.js';

const DEG = Math.PI / 180;
const SHIP_RADIUS = 3;					// bolts passing this close to the turret hit the ship
const MISS_SPREAD = 8;					// aim error, up to this far from the turret (uniform in radius)
const FIRE_RANGE = [10, 90];			// only shoots from between these distances
const FACING = Math.cos(15 * DEG);		// only shoots with its nose within 15° of us
const BURST = 3;						// pairs per burst
const BURST_INTERVAL = 0.16;			// seconds between pairs in a burst
const PAUSE = [3.0, 6.0];				// seconds between bursts, min..max (four fighters share the sky)
const GUN_OFFSET = { side: 0.3, down: 0.35, ahead: 0.6 };	// guns, relative to the fighter's centre

const BOLT_STYLE = {
	speed: 90,							// slower than ours, so you can see them coming
	length: 4,
	range: 200,
	core: 'rgb(190, 255, 190)',
	glow: 'rgba(40, 255, 80, 0.35)',
};

export class EnemyFire {
	bolts = [];
	// Called with the fighter's position each time a fighter fires a pair (for sound).
	onFire = null;
	#guns = new Map();		// fighter -> { pause, shotsLeft, shotTimer }

	/** @param {object} worldFrame - Model3D parent that applies the turret's view. */
	constructor(worldFrame) {
		this.worldFrame = worldFrame;
	}

	/**
	 * Fire from any fighter lined up on us, move the bolts, and count hits.
	 * @returns {number} how many bolts hit the ship this frame.
	 */
	update(dt, fighters) {
		for (const fighter of fighters) {
			this.#updateFighter(fighter, dt);
		}
		// Forget fighters that are gone (shot down).
		for (const fighter of this.#guns.keys()) {
			if (!fighters.includes(fighter)) {
				this.#guns.delete(fighter);
			}
		}

		let hits = 0;
		for (const bolt of this.bolts) {
			bolt.update(dt);
			if (bolt.passedWithin([0, 0, 0], SHIP_RADIUS)) {
				bolt.spent = true;
				hits++;
			}
		}
		this.bolts = this.bolts.filter((bolt) => !bolt.done);
		return hits;
	}

	/** Stop all fire (e.g. on restart). */
	clear() {
		this.bolts = [];
		this.#guns.clear();
	}

	get models() {
		return this.bolts.flatMap((bolt) => bolt.models);
	}

	#updateFighter(fighter, dt) {
		let gun = this.#guns.get(fighter);
		if (!gun) {
			gun = { pause: between(PAUSE), shotsLeft: 0, shotTimer: 0 };
			this.#guns.set(fighter, gun);
		}

		if (gun.shotsLeft > 0) {
			// Mid-burst: keep firing even if it turns a little off.
			gun.shotTimer -= dt;
			if (gun.shotTimer <= 0) {
				this.#firePair(fighter);
				gun.shotsLeft--;
				gun.shotTimer = BURST_INTERVAL;
				if (gun.shotsLeft === 0) {
					gun.pause = between(PAUSE);
				}
			}
			return;
		}

		gun.pause -= dt;
		if (gun.pause <= 0 && this.#linedUp(fighter)) {
			gun.shotsLeft = BURST;
			gun.shotTimer = 0;
		}
	}

	#linedUp(fighter) {
		const range = fighter.range;
		if (range < FIRE_RANGE[0] || range > FIRE_RANGE[1]) {
			return false;
		}
		const toShip = scale(fighter.position, -1 / range);
		const d = fighter.direction;
		return d[0] * toShip[0] + d[1] * toShip[1] + d[2] * toShip[2] >= FACING;
	}

	#firePair(fighter) {
		this.onFire?.(fighter.position);
		const forward = fighter.direction;
		// The fighter's right and up (it flies level: no roll).
		let right = cross([0, 1, 0], forward);
		right = length(right) > 1e-6 ? normalize(right) : [1, 0, 0];
		const up = cross(forward, right);

		// One aim point per pair: somewhere near the turret, maybe close enough to hit.
		const toShip = normalize(scale(fighter.position, -1));
		let across = cross(toShip, [0, 1, 0]);
		across = length(across) > 1e-6 ? normalize(across) : [1, 0, 0];
		const vertical = cross(across, toShip);
		const angle = Math.random() * 2 * Math.PI;
		const miss = Math.random() * MISS_SPREAD;
		const aimPoint = add(scale(across, miss * Math.cos(angle)), scale(vertical, miss * Math.sin(angle)));

		for (const side of [-1, 1]) {
			const origin = add(fighter.position, add(add(
				scale(right, side * GUN_OFFSET.side),
				scale(up, -GUN_OFFSET.down)),
				scale(forward, GUN_OFFSET.ahead)));
			this.bolts.push(new Bolt({
				origin,
				direction: normalize(sub(aimPoint, origin)),
				style: BOLT_STYLE,
				frame: this.worldFrame,
			}));
		}
	}
}

function between([low, high]) {
	return low + Math.random() * (high - low);
}
