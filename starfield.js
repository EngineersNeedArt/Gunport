// starfield.js
//
// A sphere of "infinitely distant" stars.
//
// Each star is stored as a homogeneous DIRECTION -- [x, y, z, 0] -- rather than a
// point [x, y, z, 1]. With w = 0 the translation row of any matrix drops out, so
// stars never move as the camera (or ship) translates; only rotation affects them.
// That is exactly how real stars behave, and it falls out of Phosphor3D's existing
// Matrix4/Camera code with no special casing: the perspective divide still works
// because the projected w comes from z, not from the original w.
//
// Motion blur: each star is drawn as a line from where it was a moment ago to
// where it is now, so fast pans leave streaks. The tail is worked out in 3D view
// space (before perspective), NOT in screen space -- see draw() for why.

import { Matrix4 } from '../Phosphor3D/matrix4.js';

// Small seeded PRNG (mulberry32) so the sky is the same on every load.
function makeRandom(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// A streak's tail is never allowed closer to the edge of the forward hemisphere
// than this (view-space z of a unit direction = cosine of its angle off the line
// of sight; 0.01 is about 89.4°). Perspective blows up as z approaches 0.
const TAIL_MIN_Z = 0.01;

// Faintest a star (or a dimmed streak) is ever drawn, 0..1.
const MIN_BRIGHTNESS = 0.5;

export class Starfield {
	// Turn streaks on/off (B key in main.js).
	motionBlur = true;

	// Streak length, measured in 60 Hz frames of motion. 1 = connect each star to
	// where it was 1/60 s ago, whatever the real frame rate, so streaks look the
	// same on 60 Hz and 120 Hz displays. Raise it for a more dramatic smear.
	blurLength = 1;

	// How a streak dims with length (see streakDimming below).
	//   blurKnee:    length in pixels at which dimming really gets going.
	//   blurFalloff: 1 = physically correct (a streak carries the same total light
	//                as the still star, just spread out); 0 = no dimming at all;
	//                0.5 = a compromise that still reads on screen.
	blurKnee = 4;
	blurFalloff = 0.5;

	#previous = [];	// per star: last frame's view-space direction [x, y, z], or undefined

	constructor(count = 400, seed = 1977) {
		const random = makeRandom(seed);

		this.stars = [];	// { brightness, size, color }
		this.points = [];	// [x, y, z, 0] unit direction per star, parallel to this.stars

		for (let i = 0; i < count; i++) {
			// Uniform distribution on the unit sphere: y is uniform in [-1, 1],
			// angle around the y axis is uniform in [0, 2π).
			const y = random() * 2 - 1;
			const angle = random() * Math.PI * 2;
			const r = Math.sqrt(1 - y * y);
			this.points.push([r * Math.cos(angle), y, r * Math.sin(angle), 0]);

			// Skew toward the dim end: most stars are near MIN_BRIGHTNESS, a few are bright.
			const brightness = MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * Math.pow(random(), 3);
			const level = Math.round(brightness * 255);
			this.stars.push({
				brightness,
				size: brightness > 0.85 ? 2 : 1,
				color: `rgb(${level}, ${level}, ${level})`,
			});
		}
	}

	/**
	 * Brightness multiplier (0..1] for a streak `length` pixels long.
	 *
	 * A still star puts all its light on a dot about `knee` pixels across; a streak
	 * spreads the same light over knee + length pixels. So the light per pixel is
	 *   knee / (knee + length)
	 * which is 1 when still and falls smoothly as the streak grows. Raising that to
	 * blurFalloff softens it: the exact value (1) makes fast-pan streaks almost
	 * invisible on a monitor, 0.5 keeps them readable while clearly dimmer.
	 *   length:   0    5    10   25   50   100
	 *   0.5:      1.00 .67  .53  .37  .27  .20
	 *   1.0:      1.00 .44  .29  .14  .07  .04
	 */
	streakDimming(length) {
		return Math.pow(this.blurKnee / (this.blurKnee + length), this.blurFalloff);
	}

	/** Forget last frame's positions (after a resize, or any sudden view jump). */
	resetMotion() {
		this.#previous = [];
	}

	/**
	 * Projects and draws the stars.
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {Camera} camera - Phosphor3D camera at the origin with no rotation
	 *        (viewport size already set). All rotation comes from viewMatrix.
	 * @param {Matrix4} viewMatrix - Rotation-only view matrix.
	 * @param {number} dt - Seconds since the last frame.
	 */
	draw(ctx, camera, viewMatrix, dt) {
		// 1. Rotate every star into view space ourselves (rotation only, so w stays 0).
		//    Same row-vector arithmetic as Matrix4.multiplyPoints, minus the divide.
		const e = viewMatrix.elements;
		const view = this.points.map(([x, y, z]) => [
			e[0] * x + e[4] * y + e[8] * z,
			e[1] * x + e[5] * y + e[9] * z,
			e[2] * x + e[6] * y + e[10] * z,
			0,
		]);

		// 2. Work out each streak's tail in view space.
		//
		// Why not in screen space? To keep streak length independent of frame rate,
		// last frame's motion is scaled (doubled at 120 Hz, more on a short frame).
		// Scaling a 2D screen-space line is only valid while perspective is roughly
		// linear. Near the edge of the view it is wildly non-linear: a star 89° off
		// axis can sit 100,000 px off screen, and extending its motion backwards
		// overshoots past 90°, where projection flips to the opposite side -- the tail
		// lands across the screen and draws a diagonal line through the middle.
		// In view space the extension is a straight move along the star's path, and
		// we can stop it just short of 90° (TAIL_MIN_Z) before projecting.
		const tailScale = dt > 0 ? Math.min(this.blurLength / 60 / dt, 4) : 0;
		const tails = [];		// view-space tail points to project
		const tailOf = [];		// star index -> index into tails, or -1

		for (let i = 0; i < view.length; i++) {
			tailOf[i] = -1;
			const cur = view[i];
			const prev = this.#previous[i];
			if (!this.motionBlur || !prev || tailScale === 0 || cur[2] <= TAIL_MIN_Z) {
				continue;
			}
			const dx = (prev[0] - cur[0]) * tailScale;
			const dy = (prev[1] - cur[1]) * tailScale;
			const dz = (prev[2] - cur[2]) * tailScale;
			let u = 1;
			if (cur[2] + dz < TAIL_MIN_Z) {
				u = (TAIL_MIN_Z - cur[2]) / dz;	// dz < 0 here, so 0 <= u < 1
			}
			tailOf[i] = tails.length;
			tails.push([cur[0] + dx * u, cur[1] + dy * u, cur[2] + dz * u, 0]);
		}
		this.#previous = view;

		// 3. Project heads and tails. The view rotation is already applied, so the
		//    camera gets an identity model matrix and adds only perspective.
		const heads = camera.projectPoints(new Matrix4(), view);
		const tailsOnScreen = camera.projectPoints(new Matrix4(), tails);
		const width = camera.viewPortWidth;
		const height = camera.viewPortHeight;

		ctx.lineCap = 'round';

		for (let i = 0; i < heads.length; i++) {
			const [sx, sy, , valid] = heads[i];
			if (!valid) {
				continue;	// Behind the viewer.
			}
			let tx = sx;
			let ty = sy;
			if (tailOf[i] >= 0) {
				[tx, ty] = tailsOnScreen[tailOf[i]];
			}

			// Skip only if the whole streak is off screen; canvas clips partial ones.
			if (Math.max(sx, tx) < 0 || Math.max(sy, ty) < 0 ||
				Math.min(sx, tx) >= width || Math.min(sy, ty) >= height) {
				continue;
			}

			const star = this.stars[i];
			const length = Math.hypot(sx - tx, sy - ty);
			ctx.globalAlpha = this.streakDimming(length);

			if (length < 1) {
				// Still, or nearly: a plain point.
				ctx.fillStyle = star.color;
				ctx.fillRect(Math.round(sx - star.size / 2), Math.round(sy - star.size / 2), star.size, star.size);
				ctx.globalAlpha = 1;
			} else {
				ctx.strokeStyle = star.color;
				ctx.lineWidth = star.size;
				ctx.beginPath();
				ctx.moveTo(tx, ty);
				ctx.lineTo(sx, sy);
				ctx.stroke();
				ctx.globalAlpha = 1;
			}
		}
	}
}
