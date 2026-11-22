// viewer.js -- look at one model from any angle, to check it while editing.
//
//   Left / Right        spin the model (turntable)
//   Up / Down           move it closer / further
//   Shift + Up / Down   tilt it toward / away from you
//   Space               start / stop spinning on its own
//   W                   toggle wireframe (no fills, so you see through to the far side)
//   R                   reset the view
//
// Reload the page to pick up changes to the model file. The dev server sends
// no-cache headers, so a plain reload is enough.
//
// The model is drawn exactly as the game draws it (renderer.js), in game
// coordinates: +x right, +y up, +z away from you, so a model whose nose points
// along +z starts out facing away. Its own x/y/z, rotation and scale from the
// JSON are applied first, as in the game.

import { Camera } from '../Phosphor3D/camera.js';
import { Matrix4 } from '../Phosphor3D/matrix4.js';
import { coordinateFrame, loadModel, drawModels } from './renderer.js';

const DEG = Math.PI / 180;
const SPIN_RATE = 90 * DEG;			// radians per second, arrow keys
const AUTO_SPIN_RATE = 30 * DEG;	// radians per second, Space
const TILT_RATE = 60 * DEG;
const ZOOM_RATE = 1.5;				// distance multiplies by this per second
const DISTANCE = { start: 9, min: 2, max: 80 };
const START_YAW = 200 * DEG;		// three-quarter view from the front, for a +z nose
const START_TILT = 15 * DEG;
const TEXT_COLOR = 'rgb(140, 150, 165)';

const params = new URLSearchParams(location.search);
const modelPath = params.get('model') ?? 'models/fighter.json';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const camera = new Camera();
camera.far = 1000;

const view = { yaw: START_YAW, tilt: START_TILT, distance: DISTANCE.start, autoSpin: false, wireframe: false };

// The model hangs on a frame that turns it, tilts it, pushes it out in front of
// the camera, then flips it into Phosphor3D's native screen orientation
// (+x screen-left, +y screen-down) -- the same last step as the game's view.
const viewFrame = coordinateFrame(() => {
	const m = new Matrix4();
	m.rotateY(view.yaw);
	m.rotateX(view.tilt);
	m.translate(0, 0, view.distance);
	m.rotateZ(Math.PI);
	return m;
});

let model = null;
let loadError = null;
loadModel(modelPath, viewFrame)
	.then((loaded) => { model = loaded; })
	.catch((error) => { loadError = error.message; });

// --- Input ------------------------------------------------------------------

const keys = new Set();
window.addEventListener('keydown', (event) => {
	if (event.code.startsWith('Arrow')) {
		event.preventDefault();	// don't scroll the page
	}
	keys.add(event.code);
	if (event.code === 'Space') {
		event.preventDefault();
		view.autoSpin = !view.autoSpin;
	} else if (event.code === 'KeyW') {
		view.wireframe = !view.wireframe;
	} else if (event.code === 'KeyR') {
		Object.assign(view, { yaw: START_YAW, tilt: START_TILT, distance: DISTANCE.start, autoSpin: false });
	}
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());

function updateView(dt) {
	const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
	const turn = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
	const upDown = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);

	view.yaw += turn * SPIN_RATE * dt;
	if (view.autoSpin) {
		view.yaw += AUTO_SPIN_RATE * dt;
	}
	if (shift) {
		view.tilt = Math.max(-90 * DEG, Math.min(90 * DEG, view.tilt + upDown * TILT_RATE * dt));
	} else {
		view.distance = Math.max(DISTANCE.min, Math.min(DISTANCE.max,
			view.distance * Math.pow(ZOOM_RATE, -upDown * dt)));
	}
}

// --- Drawing ----------------------------------------------------------------

function resize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	camera.viewPortWidth = canvas.width;
	camera.viewPortHeight = canvas.height;
}
window.addEventListener('resize', resize);
resize();

function drawText() {
	ctx.font = '14px monospace';
	ctx.fillStyle = TEXT_COLOR;
	ctx.textBaseline = 'top';
	const lines = [modelPath];
	if (loadError) {
		lines.push(`Couldn't load: ${loadError}`);
	} else if (model) {
		const faceCount = model.faces2.length || model.faces.length;
		const subfaceCount = model.subfaces?.length ?? 0;
		lines.push(`${model.vertices.length} vertices, ${faceCount} faces, ${subfaceCount} subfaces`);
	}
	lines.push(
		`turn ${Math.round(((view.yaw / DEG) % 360 + 360) % 360)}°  tilt ${Math.round(view.tilt / DEG)}°  distance ${view.distance.toFixed(1)}`,
		'',
		'←/→ turn   ↑/↓ closer/further   shift ↑/↓ tilt',
		`space spin ${view.autoSpin ? 'ON' : 'off'}   W wireframe ${view.wireframe ? 'ON' : 'off'}   R reset`,
	);
	lines.forEach((line, i) => ctx.fillText(line, 16, 16 + i * 20));
}

// The same model with every fill removed (the model's own and any per-face ones).
function wireframeOf(model) {
	const unfilled = (faces) => faces?.map((face) => ({ ...face, fill: null }));
	return Object.assign(Object.create(Object.getPrototypeOf(model)), model, {
		fill: null,
		faces2: unfilled(model.faces2),
		subfaces: unfilled(model.subfaces) ?? null,
	});
}

let lastTime = performance.now();
function frame(now) {
	const dt = Math.min(0.1, (now - lastTime) / 1000);
	lastTime = now;
	updateView(dt);

	ctx.fillStyle = 'black';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	if (model) {
		drawModels(ctx, camera, [view.wireframe ? wireframeOf(model) : model]);
	}
	drawText();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
