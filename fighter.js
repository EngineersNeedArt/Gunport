// fighter.js -- an enemy fighter's flight.
//
// The fighter flies at constant speed toward a waypoint, but can only turn so
// fast, so it carves smooth curves instead of zig-zagging. When it gets close to
// a waypoint it picks the next one. Waypoints alternate between:
//   - loiter points far out (it swings around at a distance), and
//   - strafing runs that pass close by the gun turret.
//
// World coordinates match the turret: +x right, +y up, +z ahead at heading 0,
// with the turret at the origin. The model's nose points along its own +z.

const DEG = Math.PI / 180;

const SPEED = 22;				// world units per second
const TURN_RATE = 70 * DEG;		// radians per second, the tightest it can turn
const ARRIVE_DISTANCE = 6;		// how close counts as reaching a waypoint
const HIT_POINTS = 2;			// hits to destroy
const HIT_RADIUS = 2.0;			// hit sphere around the centre (the wing panels reach ~2.2 out)
const FLASH_TIME = 0.12;		// seconds the model flashes white when hit
const FLASH_COLOR = 'rgb(255, 255, 255)';

export class Fighter {
	position = [0, 0, 0];
	direction = [0, 0, 1];		// unit vector, the way the nose points
	radius = HIT_RADIUS;
	hitPoints = HIT_POINTS;
	destroyed = false;
	#waypoint = [0, 0, 0];
	#strafeNext = false;
	#flash = 0;					// seconds of hit flash left
	#stroke = null;				// the model's normal outline colour

	/**
	 * @param {Model3D} model - drawn at the fighter's position and heading.
	 * @param {number} startHeading - turret heading (radians) to appear near.
	 */
	constructor(model, startHeading = 0) {
		this.model = model;
		this.#stroke = model.stroke;
		// Start far out, a little above the horizon, where the gun points at first,
		// flying across the view so it's easy to spot.
		this.position = fromAngles(startHeading, 15 * DEG, 55);
		this.direction = normalize([Math.cos(startHeading), 0.1, -Math.sin(startHeading)]);
		this.#pickWaypoint();
		this.#syncModel();
	}

	update(dt) {
		const toWaypoint = sub(this.#waypoint, this.position);
		if (length(toWaypoint) < ARRIVE_DISTANCE) {
			this.#pickWaypoint();
		}
		this.direction = turnToward(this.direction, normalize(sub(this.#waypoint, this.position)), TURN_RATE * dt);
		for (let i = 0; i < 3; i++) {
			this.position[i] += this.direction[i] * SPEED * dt;
		}
		if (this.#flash > 0) {
			this.#flash -= dt;
			if (this.#flash <= 0) {
				this.model.stroke = this.#stroke;
			}
		}
		this.#syncModel();
	}

	/** Take one hit. Returns true if that destroyed it. */
	hit() {
		if (this.destroyed) {
			return false;
		}
		this.hitPoints -= 1;
		if (this.hitPoints <= 0) {
			this.destroyed = true;
			this.model.stroke = this.#stroke;
			return true;
		}
		this.#flash = FLASH_TIME;
		this.model.stroke = FLASH_COLOR;
		return false;
	}

	/** Distance from the turret, in world units. */
	get range() {
		return length(this.position);
	}

	/** World units per second, as a vector. */
	get velocity() {
		return [this.direction[0] * SPEED, this.direction[1] * SPEED, this.direction[2] * SPEED];
	}

	#pickWaypoint() {
		const heading = Math.random() * 2 * Math.PI;
		if (this.#strafeNext) {
			// Close pass: aim at a point near the turret, so it flies by at 6-12 units.
			this.#waypoint = fromAngles(heading, (10 + Math.random() * 50) * DEG, 6 + Math.random() * 6);
		} else {
			// Loiter: somewhere well out, mostly above the horizon.
			this.#waypoint = fromAngles(heading, (5 + Math.random() * 70) * DEG, 35 + Math.random() * 30);
		}
		// Mostly loiter, with a strafing run about one time in three.
		this.#strafeNext = !this.#strafeNext && Math.random() < 0.5;
	}

	// Point the model's nose (+z) along `direction`. Model3D applies xRot (pitch)
	// before yRot (heading), which is the order this needs.
	#syncModel() {
		const [dx, dy, dz] = this.direction;
		this.model.x = this.position[0];
		this.model.y = this.position[1];
		this.model.z = this.position[2];
		this.model.xRot = Math.atan2(dy, Math.hypot(dx, dz));
		this.model.yRot = Math.atan2(-dx, dz);
	}
}

// --- Small vector helpers ---------------------------------------------------

// A point at a turret heading/elevation and distance (heading 0 = +z, 90° = +x).
function fromAngles(heading, elevation, distance) {
	return [
		distance * Math.cos(elevation) * Math.sin(heading),
		distance * Math.sin(elevation),
		distance * Math.cos(elevation) * Math.cos(heading),
	];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
	const len = length(v) || 1;
	return [v[0] / len, v[1] / len, v[2] / len];
}

// Rotate unit vector `from` toward unit vector `to` by at most `maxAngle` radians.
function turnToward(from, to, maxAngle) {
	const cos = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
	const angle = Math.acos(cos);
	if (angle <= maxAngle) {
		return to;
	}
	// The part of `to` at right angles to `from` gives the turning direction.
	let side = [to[0] - from[0] * cos, to[1] - from[1] * cos, to[2] - from[2] * cos];
	if (length(side) < 1e-6) {
		side = Math.abs(from[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];   // dead astern: pick any way round
		const d = side[0] * from[0] + side[1] * from[1] + side[2] * from[2];
		side = [side[0] - from[0] * d, side[1] - from[1] * d, side[2] - from[2] * d];
	}
	side = normalize(side);
	const c = Math.cos(maxAngle);
	const s = Math.sin(maxAngle);
	return normalize([from[0] * c + side[0] * s, from[1] * c + side[1] * s, from[2] * c + side[2] * s]);
}
