// explosion.js -- a destroyed fighter coming apart.
//
// Two parts, both ordinary Phosphor3D models so they depth-sort with everything else:
//   - shards: every face of the fighter's model becomes its own tumbling wireframe
//     piece, flung outward from the centre (and still carrying the fighter's momentum),
//     fading as it goes;
//   - sparks: short bright lines bursting out in all directions, hot white-yellow
//     cooling to orange, gone in under a second.

import { Model3D } from '../Phosphor3D/model3d.js';

const DEG = Math.PI / 180;
const SHARD_LIFE = 1.6;				// seconds
const SHARD_SPEED = [4, 10];		// world units per second, min..max, outward
const SHARD_SPIN = 360 * DEG;		// up to this many radians per second on each axis
const SPARK_COUNT = 28;
const SPARK_LIFE = [0.4, 0.9];		// seconds, min..max
const SPARK_SPEED = [12, 32];
const SPARK_LENGTH = 1.6;
const DEFAULT_RGB = [51, 255, 102];	// shard colour if the model's stroke isn't rgb(...)

export class Explosion {
	time = 0;
	#shards = [];	// { model, velocity, spin }
	#sparks = [];	// { model, position, velocity, life }

	/**
	 * @param {Model3D} model - the fighter's model, at the moment it was destroyed.
	 * @param {number[]} velocity - the fighter's velocity, so the wreck keeps drifting.
	 * @param {object} worldFrame - Model3D parent that applies the turret's view.
	 */
	constructor(model, velocity, worldFrame) {
		const center = [model.x, model.y, model.z];
		const world = worldVertices(model);

		// Either face form (Model3D uses faces2 if it has any).
		const faceList = model.faces2.length ? model.faces2 : model.faces.map((vertices) => ({ vertices }));
		const rgb = parseRGB(model.stroke) ?? DEFAULT_RGB;
		const shardStroke = (alpha) => `rgba(${rgb.join(', ')}, ${alpha.toFixed(3)})`;
		for (const face of faceList) {
			const ids = face.vertices.slice(0, -1);	// faces are closed: drop the repeated first vertex
			const corners = ids.map((i) => world[i]);
			const middle = average(corners);
			const shard = new Model3D();
			if (face.billboard) {
				// Stays a billboard (the ball still looks like a ball as it flies off).
				// Billboards lay out their model-space x/y offsets flat to the screen,
				// so keep those, scaled, rather than the rotated world-space corners.
				const local = ids.map((i) => model.vertices[i]);
				const localMiddle = average(local);
				shard.vertices = local.map((c) => [
					(c[0] - localMiddle[0]) * model.scale, (c[1] - localMiddle[1]) * model.scale, 0, 1]);
			} else {
				shard.vertices = corners.map((c) => [c[0] - middle[0], c[1] - middle[1], c[2] - middle[2], 1]);
			}
			// Both sides visible as it tumbles; closed so every edge is drawn.
			shard.faces2 = [{ vertices: [...corners.keys(), 0], doublesided: true, billboard: !!face.billboard }];
			shard.fill = null;
			shard.lineWidth = model.lineWidth ?? 1.5;
			shard.strokeAt = shardStroke;
			shard.x = middle[0];
			shard.y = middle[1];
			shard.z = middle[2];
			shard.parent = worldFrame;
			const outward = normalize(sub(middle, center));
			const speed = between(SHARD_SPEED);
			this.#shards.push({
				model: shard,
				velocity: add(velocity.map((v) => v * 0.5), outward.map((v) => v * speed)),
				spin: [between([-1, 1]) * SHARD_SPIN, between([-1, 1]) * SHARD_SPIN, between([-1, 1]) * SHARD_SPIN],
			});
		}

		for (let i = 0; i < SPARK_COUNT; i++) {
			const spark = new Model3D();
			spark.vertices = [[0, 0, 0, 1], [0, 0, 0, 1]];
			spark.faces = [[0, 1]];
			spark.fill = null;
			spark.lineWidth = 2;
			spark.parent = worldFrame;
			this.#sparks.push({
				model: spark,
				position: [...center],
				velocity: add(velocity.map((v) => v * 0.5), randomDirection().map((v) => v * between(SPARK_SPEED))),
				life: between(SPARK_LIFE),
			});
		}
		this.update(0);
	}

	update(dt) {
		this.time += dt;

		const shardFade = Math.max(0, 1 - this.time / SHARD_LIFE);
		for (const shard of this.#shards) {
			const m = shard.model;
			m.x += shard.velocity[0] * dt;
			m.y += shard.velocity[1] * dt;
			m.z += shard.velocity[2] * dt;
			m.xRot += shard.spin[0] * dt;
			m.yRot += shard.spin[1] * dt;
			m.zRot += shard.spin[2] * dt;
			m.stroke = m.strokeAt(shardFade);
		}

		for (const spark of this.#sparks) {
			for (let i = 0; i < 3; i++) {
				spark.position[i] += spark.velocity[i] * dt;
			}
			const heat = Math.max(0, 1 - this.time / spark.life);	// 1 = just born, 0 = gone
			const tail = sub(spark.position, normalize(spark.velocity).map((v) => v * SPARK_LENGTH * heat));
			spark.model.vertices[0] = [...tail, 1];
			spark.model.vertices[1] = [...spark.position, 1];
			// White-yellow when fresh, cooling to orange, then fading out.
			const green = Math.round(110 + 140 * heat);
			const blue = Math.round(20 + 180 * heat * heat);
			spark.model.stroke = `rgba(255, ${green}, ${blue}, ${heat.toFixed(3)})`;
		}
	}

	get done() {
		return this.time >= SHARD_LIFE;
	}

	/** Models to draw this frame (sparks that have burnt out are left off). */
	get models() {
		const models = [];
		if (this.time < SHARD_LIFE) {
			for (const shard of this.#shards) {
				models.push(shard.model);
			}
		}
		for (const spark of this.#sparks) {
			if (this.time < spark.life) {
				models.push(spark.model);
			}
		}
		return models;
	}
}

// The model's vertices in world space (its own transform only, not the view).
function worldVertices(model) {
	const parent = model.parent;
	model.parent = null;
	const e = model.localMatrix().elements;
	model.parent = parent;
	return model.vertices.map(([x, y, z]) => [
		e[0] * x + e[4] * y + e[8] * z + e[12],
		e[1] * x + e[5] * y + e[9] * z + e[13],
		e[2] * x + e[6] * y + e[10] * z + e[14],
	]);
}

// [r, g, b] from 'rgb(r, g, b)' or 'rgba(r, g, b, a)', else null.
function parseRGB(color) {
	const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color ?? '');
	return match ? match.slice(1, 4).map(Number) : null;
}

function between([low, high]) {
	return low + Math.random() * (high - low);
}

function randomDirection() {
	const y = Math.random() * 2 - 1;
	const angle = Math.random() * 2 * Math.PI;
	const r = Math.sqrt(1 - y * y);
	return [r * Math.cos(angle), y, r * Math.sin(angle)];
}

function average(points) {
	const sum = [0, 0, 0];
	for (const p of points) {
		sum[0] += p[0];
		sum[1] += p[1];
		sum[2] += p[2];
	}
	return sum.map((s) => s / points.length);
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v) {
	const len = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / len, v[1] / len, v[2] / len];
}
