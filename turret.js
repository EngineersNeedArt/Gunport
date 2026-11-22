// turret.js
//
// The player's gun turret: pans (yaw) freely all the way around, and tilts (pitch)
// like a telescope between 0° (horizontal) and 90° (straight up).
//
// World convention used by the game: +x right, +y up, +z straight ahead at yaw 0.

import { Matrix4 } from '../Phosphor3D/matrix4.js';

const DEG = Math.PI / 180;

export class Turret {
	static PAN_MAX_RATE = 100 * DEG;	// radians per second
	static PITCH_MAX_RATE = 60 * DEG;
	static ACCEL = 900 * DEG;			// radians per second², how fast it spins up/down
	static PITCH_MIN = 0;
	static PITCH_MAX = 90 * DEG;

	yaw = 0;
	pitch = 10 * DEG;
	yawRate = 0;
	pitchRate = 0;

	// Input state: -1, 0 or 1.
	panInput = 0;
	pitchInput = 0;

	update(dt) {
		this.yawRate = approach(this.yawRate, this.panInput * Turret.PAN_MAX_RATE, Turret.ACCEL * dt);
		this.pitchRate = approach(this.pitchRate, this.pitchInput * Turret.PITCH_MAX_RATE, Turret.ACCEL * dt);

		this.yaw += this.yawRate * dt;
		this.yaw = ((this.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

		this.pitch += this.pitchRate * dt;
		if (this.pitch < Turret.PITCH_MIN) {
			this.pitch = Turret.PITCH_MIN;
			this.pitchRate = 0;
		} else if (this.pitch > Turret.PITCH_MAX) {
			this.pitch = Turret.PITCH_MAX;
			this.pitchRate = 0;
		}
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

	// Bezel tilt. The view follows the gun all the way up, but the window frame only
	// partly follows it, as if the gunner tips their head back a little further than
	// the turret. So the bezel counter-rotates by this fraction of the gun's pitch:
	// 0.12 means 90° of aim drops the bezel about 11°.
	static BEZEL_TILT = 0.12;

	// Where the bezel's tilt pivots, as a distance in front of the eye:
	//   0      -- pivot at the eye (what really happens when your head tips back):
	//             the frame slides down AND foreshortens slightly. (default)
	//   2      -- pivot in the bezel plane (z = 2): it foreshortens in place, barely slides.
	//   large  -- e.g. 1000: approaches a pure slide down, no foreshortening.
	//   negative -- pivot behind the head: slides more than it turns.
	static BEZEL_PIVOT_Z = 0;

	/**
	 * Matrix for things fixed to the gunner's seat -- the window bezel, later the
	 * cannon. Row-vector order, so: move the pivot to the origin, tilt, move back,
	 * then convert to Phosphor3D's screen mapping (as in viewMatrix).
	 */
	cockpitMatrix() {
		const tilt = -Turret.BEZEL_TILT * this.pitch;	// aim up => frame tips down
		const m = new Matrix4();
		m.translate(0, 0, -Turret.BEZEL_PIVOT_Z);
		m.rotateX(tilt);
		m.translate(0, 0, Turret.BEZEL_PIVOT_Z);
		m.rotateZ(Math.PI);
		return m;
	}
}

function approach(value, target, step) {
	if (value < target) {
		return Math.min(value + step, target);
	}
	return Math.max(value - step, target);
}
