// turret.js
//
// The player's gun turret, looking straight out of the side of the ship. It pans
// left/right and tilts up/down, each limited to PAN_LIMIT / TILT_LIMIT either side
// of straight out, so the guns cover a cone in front of the ship rather than the
// whole sky. It eases to a stop at the limits instead of hitting them.
//
// World convention used by the game: +x right, +y up, +z straight out at yaw 0
// and pitch 0 (the centre of the targeting cone).

import { Matrix4 } from '../Phosphor3D/matrix4.js';

const DEG = Math.PI / 180;

export class Turret {
	static PAN_MAX_RATE = 100 * DEG;	// radians per second
	static PITCH_MAX_RATE = 60 * DEG;
	static ACCEL = 900 * DEG;			// radians per second², how fast it spins up/down
	static PAN_LIMIT = 70 * DEG;		// either side of straight out: 140° across
	static TILT_LIMIT = 70 * DEG;		// above and below straight out: 140° top to bottom

	yaw = 0;		// + is right
	pitch = 0;		// + is up
	yawRate = 0;
	pitchRate = 0;

	// Input state: -1..1 from the keys, up to about ±1.8 from the mouse.
	panInput = 0;
	pitchInput = 0;

	update(dt) {
		[this.yaw, this.yawRate] = move(this.yaw, this.yawRate,
			this.panInput * Turret.PAN_MAX_RATE, Turret.PAN_LIMIT, dt);
		[this.pitch, this.pitchRate] = move(this.pitch, this.pitchRate,
			this.pitchInput * Turret.PITCH_MAX_RATE, Turret.TILT_LIMIT, dt);
	}

	/** The aim as three unit vectors in world space: where it points, its right and its up. */
	axes() {
		const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
		const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
		return {
			forward: [sy * cp, sp, cy * cp],
			right: [cy, 0, -sy],
			up: [-sy * sp, cp, -cy * sp],
		};
	}

	/**
	 * A fresh view matrix for the current aim. Phosphor3D's matrices are row-vector
	 * (v' = v * M), so operations apply in the order written:
	 *   1. undo the pan (rotate about y),
	 *   2. undo the tilt (rotate about x) -- in the panned frame, so it stays a true tilt,
	 *   3. rotate 180° about z to map the game's +x right / +y up convention onto
	 *      Phosphor3D's screen mapping (which otherwise shows +x left, +y down).
	 */
	viewMatrix() {
		const m = new Matrix4();
		m.rotateY(this.yaw);
		m.rotateX(-this.pitch);
		m.rotateZ(Math.PI);
		return m;
	}

	// Bezel tilt and swing. The view follows the gun all the way, but the window
	// frame only partly follows it, as if the gunner turns their head a little
	// further than the turret. So the bezel counter-rotates by this fraction of the
	// aim, both ways: 0.12 means 70° of aim up drops the bezel about 8° (aiming down
	// raises it), and 70° of aim right swings it about 8° to the left.
	static BEZEL_TILT = 0.12;

	// Where the bezel's tilt pivots, as a distance in front of the eye:
	//   0      -- pivot at the eye (what really happens when your head tips back):
	//             the frame slides down AND foreshortens slightly. (default)
	//   2      -- pivot in the bezel plane (z = 2): it foreshortens in place, barely slides.
	//   large  -- e.g. 1000: approaches a pure slide down, no foreshortening.
	//   negative -- pivot behind the head: slides more than it turns.
	static BEZEL_PIVOT_Z = 0;

	/**
	 * Matrix for the cannon, which turns and tilts exactly with the aim, so in
	 * gun space (+x right, +y up, +z along the aim) it only needs converting to
	 * Phosphor3D's screen mapping (as in viewMatrix).
	 */
	gunMatrix() {
		const m = new Matrix4();
		m.rotateZ(Math.PI);
		return m;
	}

	/**
	 * Matrix for things fixed to the gunner's seat -- the window bezel. Row-vector order, so: move the pivot to the origin, tilt, move back,
	 * then convert to Phosphor3D's screen mapping (as in viewMatrix).
	 */
	cockpitMatrix() {
		// Lag a fraction of the aim, turning the same way the view does (so the frame
		// drifts like the stars, only less): aim up => frame tips down, aim right =>
		// frame swings left.
		const pan = Turret.BEZEL_TILT * this.yaw;
		const tilt = -Turret.BEZEL_TILT * this.pitch;
		const m = new Matrix4();
		m.translate(0, 0, -Turret.BEZEL_PIVOT_Z);
		m.rotateY(pan);
		m.rotateX(tilt);
		m.translate(0, 0, Turret.BEZEL_PIVOT_Z);
		m.rotateZ(Math.PI);
		return m;
	}
}

// One axis of the turret: speed `rate` toward `targetRate` at up to ACCEL, without
// passing ±limit -- near a limit the speed toward it is capped to what can still
// stop in time, so the turret glides to a halt there. Returns [angle, rate].
function move(angle, rate, targetRate, limit, dt) {
	const stoppingRate = (distance) => Math.sqrt(2 * Turret.ACCEL * Math.max(0, distance));
	targetRate = Math.min(targetRate, stoppingRate(limit - angle));
	targetRate = Math.max(targetRate, -stoppingRate(limit + angle));
	rate = approach(rate, targetRate, Turret.ACCEL * dt);
	angle += rate * dt;
	if (Math.abs(angle) >= limit) {
		angle = Math.sign(angle) * limit;
		rate = 0;
	}
	return [angle, rate];
}

function approach(value, target, step) {
	if (value < target) {
		return Math.min(value + step, target);
	}
	return Math.max(value - step, target);
}
