// main.js -- Gunport: a retro first-person turret game built on Phosphor3D.

import { Camera } from '../Phosphor3D/camera.js';
import { FPS } from '../Phosphor3D/fps.js';
import { Starfield } from './starfield.js';
import { Turret } from './turret.js';
import { coordinateFrame, loadModel, loadJSON, modelFromJSON, drawModels } from './renderer.js';
import { Fighter } from './fighter.js';
import { Guns } from './guns.js';
import { Explosion } from './explosion.js';
import { Cannon } from './cannon.js';
import { EnemyFire } from './enemyfire.js';
import { Sound } from './sound.js';

const PHOSPHOR_GREEN = '#33ff66';
const WARNING_ORANGE = '#ffaa33';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

// The camera stays at the origin with zero rotation: the turret supplies the
// pan/tilt rotation as a view matrix (see Turret.viewMatrix for why).
const camera = new Camera();
const starfield = new Starfield(400);
const turret = new Turret();
const fps = new FPS();
const sound = new Sound();

// --- Models -----------------------------------------------------------------

// Things fixed to the gunner's seat.
const cockpitFrame = coordinateFrame(() => shaken(turret.cockpitMatrix()));
const cockpitModels = [];

// Things out in space, seen through the turret's aim.
const worldFrame = coordinateFrame(() => turret.viewMatrix());
const worldModels = [];
const fighters = [];
const guns = new Guns(worldFrame);
const enemyFire = new EnemyFire(worldFrame);

// Sounds for shots (the rest are in updateCombat and damageShip). A little random
// variation in speed (and so pitch) keeps rapid fire from sounding mechanical.
const vary = (amount) => 1 + (Math.random() * 2 - 1) * amount;
guns.onFire = (pair) => {
	cannon?.recoil(pair);
	sound.play('laser', { volume: 0.18, rate: vary(0.05) });	// fires ~7 pairs/s, so copies overlap
};
enemyFire.onFire = (position) => sound.play('enemyLaser', { position, volume: 0.9, rate: vary(0.06) });

// The laser cannon overhead: turns and tilts with the aim, and its barrel tips
// are where the bolts come from.
const gunFrame = coordinateFrame(() => shaken(turret.gunMatrix()));
let cannon = null;
Promise.all([loadJSON('models/cannon-body.json'), loadJSON('models/cannon-barrel.json')])
	.then(([body, barrel]) => {
		cannon = new Cannon(body, barrel, gunFrame);
		guns.muzzlePairs = cannon.muzzlePairs;
	})
	.catch((error) => console.error(error));

loadModel('models/bezel.json', cockpitFrame)
	.then((model) => cockpitModels.push(model))
	.catch((error) => console.error(error));

// --- Combat -----------------------------------------------------------------

const RESPAWN_DELAY = 2.5;	// seconds after a kill before the next fighter appears
const explosions = [];
let fighterJSON = null;		// loaded once; each fighter gets its own copy
let kills = 0;
let respawnTimer = -1;		// counting down while waiting to respawn; -1 = not waiting

loadJSON('models/fighter.json')
	.then((json) => {
		fighterJSON = json;
		spawnFighter(turret.yaw, turret.pitch + 15 * Math.PI / 180);	// the first one appears where you're looking
	})
	.catch((error) => console.error(error));

function spawnFighter(heading, elevation) {
	fighters.push(new Fighter(modelFromJSON(fighterJSON, worldFrame), heading, elevation));
}

function updateCombat(dt) {
	damageShip(enemyFire.update(dt, fighters));

	for (const fighter of guns.hitTest(fighters)) {
		if (fighter.destroyed) {
			continue;	// two bolts in the same frame: it's already gone
		}
		if (!fighter.hit()) {
			sound.play('clank', { position: fighter.position, volume: 0.7, rate: vary(0.1) });
		} else {
			// Explosions carry: half volume at 50 units (other sounds: 15).
			sound.play('explosion', { position: fighter.position, rate: vary(0.1), falloff: 50 });
			fighters.splice(fighters.indexOf(fighter), 1);
			explosions.push(new Explosion(fighter.model, fighter.velocity, worldFrame));
			kills += 1;
			respawnTimer = RESPAWN_DELAY;
		}
	}

	for (const explosion of explosions) {
		explosion.update(dt);
	}
	for (let i = explosions.length - 1; i >= 0; i--) {
		if (explosions[i].done) {
			explosions.splice(i, 1);
		}
	}

	if (respawnTimer >= 0) {
		respawnTimer -= dt;
		if (respawnTimer < 0 && fighterJSON) {
			// Anywhere in the turret's reach (follow the arrow).
			const spread = (limit) => (Math.random() * 2 - 1) * limit;
			spawnFighter(spread(Turret.PAN_LIMIT * 0.8), spread(Turret.TILT_LIMIT * 0.6));
		}
	}
}

// --- Our ship ---------------------------------------------------------------
// Enemy bolts that reach the ship damage the hull. Each hit flashes the screen
// and jolts the cockpit (bezel and cannon); at zero the ship is lost.

const HULL_MAX = 100;
const HIT_DAMAGE = 5;			// hull points per enemy bolt (20 hits to lose the ship)
const SHAKE_TIME = 0.35;		// seconds a hit's jolt lasts
const SHAKE_SIZE = 0.05;		// how far the cockpit jolts (world units; the bezel is 2 out)
const FLASH_TIME = 0.25;		// seconds a hit's flash lasts
const LOW_HULL = 30;			// at or below this, the hull readout turns orange

let hull = HULL_MAX;
let shipLost = false;
let shakeTime = 0;
let flashTime = 0;
let shakeOffset = [0, 0];		// this frame's jolt, shared by everything in the cockpit

function damageShip(hits) {
	if (hits === 0 || shipLost) {
		return;
	}
	hull = Math.max(0, hull - hits * HIT_DAMAGE);
	shakeTime = SHAKE_TIME;
	flashTime = FLASH_TIME;
	sound.play('hullHit', { volume: 0.9, rate: vary(0.08) });
	if (hull === 0) {
		shipLost = true;
		sound.play('explosion', { volume: 1, rate: 0.6 });	// slowed down: deeper, longer
		updateInput();	// lets go of the trigger
	}
}

function restart() {
	hull = HULL_MAX;
	kills = 0;
	shipLost = false;
	enemyFire.clear();
	updateInput();
}

function updateShip(dt) {
	shakeTime = Math.max(0, shakeTime - dt);
	flashTime = Math.max(0, flashTime - dt);
	const size = SHAKE_SIZE * shakeTime / SHAKE_TIME;
	shakeOffset = [(Math.random() * 2 - 1) * size, (Math.random() * 2 - 1) * size];
}

// A cockpit matrix with this frame's jolt added (in screen-mapped space, last).
function shaken(matrix) {
	if (shakeTime > 0) {
		matrix.translate(shakeOffset[0], shakeOffset[1], 0);
	}
	return matrix;
}

// --- Intro screen -----------------------------------------------------------
// The game waits behind the intro until it's dismissed with a click or a key.
// That click or key press is also what lets the browser start playing sound.

let started = false;
const intro = document.getElementById('intro');

function startGame() {
	if (started) {
		return;
	}
	started = true;
	intro.classList.add('hidden');
	sound.start();
}

intro.addEventListener('click', startGame);

// --- Input ------------------------------------------------------------------

const keys = new Set();

// Mouse steering works like a joystick: the further the pointer is from the
// centre of the screen, the faster the turret turns that way. Inside a small
// dead zone around the centre it holds still.
const mouse = {
	enabled: true,	// M key toggles
	inside: false,	// pointer over the window?
	x: 0,			// canvas pixels
	y: 0,
};
// Mouse steering tuning. Offsets are fractions of the half-screen, per axis.
const MOUSE_DEAD_ZONE = 0.06;	// no turning inside this
const MOUSE_FULL_AT = 0.7;		// top speed is reached here, not only at the very edge
const MOUSE_CURVE = 1.5;		// 1 = linear, 2 = gentle near centre; between = both fine aim and punch
const MOUSE_GAIN = 1.8;			// mouse top speed as a multiple of the keyboard's

// Map a pointer offset (-1..1 from centre to edge) to a turn rate, as a multiple
// of the turret's keyboard top speed (so up to ±MOUSE_GAIN).
function mouseAxis(offset) {
	const magnitude = Math.abs(offset);
	if (magnitude <= MOUSE_DEAD_ZONE) {
		return 0;
	}
	const t = Math.min((magnitude - MOUSE_DEAD_ZONE) / (MOUSE_FULL_AT - MOUSE_DEAD_ZONE), 1);
	return Math.sign(offset) * MOUSE_GAIN * Math.pow(t, MOUSE_CURVE);
}

function updateInput() {
	const left = keys.has('ArrowLeft') || keys.has('KeyA');
	const right = keys.has('ArrowRight') || keys.has('KeyD');
	const up = keys.has('ArrowUp') || keys.has('KeyW');
	const down = keys.has('ArrowDown') || keys.has('KeyS');
	let pan = (right ? 1 : 0) - (left ? 1 : 0);
	let pitch = (up ? 1 : 0) - (down ? 1 : 0);

	// Keys win while held; otherwise the mouse steers.
	if (mouse.enabled && mouse.inside) {
		if (!left && !right) {
			pan = mouseAxis((mouse.x - canvas.width / 2) / (canvas.width / 2));
		}
		if (!up && !down) {
			pitch = mouseAxis((canvas.height / 2 - mouse.y) / (canvas.height / 2));
		}
	}
	turret.panInput = pan;
	turret.pitchInput = pitch;

	// Trigger: Space, or the main mouse button held down over the game.
	guns.firing = !shipLost && (keys.has('Space') || mouseButtonDown);
}

let mouseButtonDown = false;

canvas.addEventListener('mousedown', (e) => {
	if (e.button === 0 && shipLost) {
		restart();
		return;
	}
	if (e.button === 0) {
		mouseButtonDown = true;
		updateInput();
	}
});

// Listen on the whole window so letting go outside the game still releases the trigger.
window.addEventListener('mouseup', (e) => {
	if (e.button === 0) {
		mouseButtonDown = false;
		updateInput();
	}
});

document.addEventListener('keydown', (e) => {
	if (e.code.startsWith('Arrow') || e.code === 'Space') {
		e.preventDefault();
	}
	if (!started) {
		startGame();	// any key dismisses the intro (and does nothing else)
		return;
	}
	if (e.code === 'KeyN' && !e.repeat) {
		sound.toggle();
	}
	if (e.code === 'KeyB' && !e.repeat) {
		starfield.motionBlur = !starfield.motionBlur;
	}
	if (e.code === 'KeyM' && !e.repeat) {
		mouse.enabled = !mouse.enabled;
	}
	if (e.code === 'Enter' && shipLost) {
		restart();
	}
	keys.add(e.code);
	updateInput();
});

canvas.addEventListener('mousemove', (e) => {
	const rect = canvas.getBoundingClientRect();
	mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
	mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
	mouse.inside = true;
	updateInput();
});

// Pointer left the window: stop turning rather than spin forever at the last rate.
canvas.addEventListener('mouseleave', () => {
	mouse.inside = false;
	updateInput();
});

document.addEventListener('keyup', (e) => {
	keys.delete(e.code);
	updateInput();
});

// Don't leave the turret spinning if the window loses focus with a key held.
window.addEventListener('blur', () => {
	keys.clear();
	mouse.inside = false;
	mouseButtonDown = false;
	updateInput();
});

// --- Layout -----------------------------------------------------------------

function resize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	camera.viewPortWidth = canvas.width;
	camera.viewPortHeight = canvas.height;
	// Old screen positions are meaningless at the new size; avoid one frame of bogus streaks.
	starfield.resetMotion();
	// The centre moved, so the same pointer position now means a different turn rate.
	updateInput();
}
window.addEventListener('resize', resize);
resize();

// --- Drawing ----------------------------------------------------------------

function drawReticle() {
	const cx = canvas.width / 2;
	const cy = canvas.height / 2;
	const gap = 8;
	const len = 18;
	ctx.strokeStyle = PHOSPHOR_GREEN;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
	ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
	ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
	ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
	ctx.stroke();
}

// The system cursor is hidden over the canvas (see index.html); instead draw a
// small diamond where the pointer is, tied to the centre by a faint line, plus a
// faint box showing the dead zone, so you can see which way and how hard you're steering.
function drawMouseMarker() {
	if (!mouse.enabled || !mouse.inside) {
		return;
	}
	const cx = canvas.width / 2;
	const cy = canvas.height / 2;
	const dzx = MOUSE_DEAD_ZONE * cx;
	const dzy = MOUSE_DEAD_ZONE * cy;
	const r = 6;

	ctx.strokeStyle = PHOSPHOR_GREEN;
	ctx.lineWidth = 1;
	ctx.globalAlpha = 0.25;
	ctx.strokeRect(cx - dzx, cy - dzy, dzx * 2, dzy * 2);
	ctx.beginPath();
	ctx.moveTo(cx, cy);
	ctx.lineTo(mouse.x, mouse.y);
	ctx.stroke();
	ctx.globalAlpha = 1;

	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(mouse.x, mouse.y - r);
	ctx.lineTo(mouse.x + r, mouse.y);
	ctx.lineTo(mouse.x, mouse.y + r);
	ctx.lineTo(mouse.x - r, mouse.y);
	ctx.closePath();
	ctx.stroke();
}

// When a target is out of view, a small arrow at the screen edge points the way to turn.
function drawOffscreenArrow(worldPosition) {
	const [x, y, z] = worldPosition;
	const [projected] = camera.projectPoints(turret.viewMatrix(), [[x, y, z, 1]]);
	const [sx, sy, , inFront] = projected;
	if (inFront && sx >= 0 && sx < canvas.width && sy >= 0 && sy < canvas.height) {
		return;	// On screen: no arrow needed.
	}

	// Rotate into view space ourselves (the view matrix is rotation only). In
	// Phosphor3D's view space, screen right is -x and screen down is +y.
	const e = turret.viewMatrix().elements;
	let dx = -(e[0] * x + e[4] * y + e[8] * z);
	let dy = e[1] * x + e[5] * y + e[9] * z;
	if (Math.hypot(dx, dy) < 1e-6) {
		dx = 1;	// Dead astern: any direction works, so say "turn right".
		dy = 0;
	}

	// Slide out from the centre along that direction until just inside the edge.
	const margin = 28;
	const cx = canvas.width / 2;
	const cy = canvas.height / 2;
	const reach = Math.min(
		(cx - margin) / Math.max(Math.abs(dx), 1e-9),
		(cy - margin) / Math.max(Math.abs(dy), 1e-9));
	const tipX = cx + dx * reach;
	const tipY = cy + dy * reach;

	const angle = Math.atan2(dy, dx);
	const size = 14;
	ctx.fillStyle = PHOSPHOR_GREEN;
	ctx.beginPath();
	ctx.moveTo(tipX, tipY);
	ctx.lineTo(tipX - size * Math.cos(angle - 0.45), tipY - size * Math.sin(angle - 0.45));
	ctx.lineTo(tipX - size * Math.cos(angle + 0.45), tipY - size * Math.sin(angle + 0.45));
	ctx.closePath();
	ctx.fill();
}

function drawHUD(frameRate) {
	// Pan and tilt from straight out, e.g. "PAN R23°  TILT D05°".
	const angle = (radians, negative, positive) => {
		const degrees = Math.round(radians * 180 / Math.PI);
		const side = degrees < 0 ? negative : degrees > 0 ? positive : ' ';
		return `${side}${String(Math.abs(degrees)).padStart(2, '0')}°`;
	};
	ctx.font = '16px ui-monospace, Menlo, monospace';
	ctx.fillStyle = PHOSPHOR_GREEN;
	ctx.textAlign = 'left';
	const status = `PAN ${angle(turret.yaw, 'L', 'R')}  TILT ${angle(turret.pitch, 'D', 'U')}   KILLS ${kills}   `;
	const hullText = `HULL ${String(hull).padStart(3, ' ')}%`;
	const controls = `FIRE [SPACE/CLICK]   SOUND ${sound.enabled ? 'ON ' : 'OFF'} [N]   MOUSE ${mouse.enabled ? 'ON ' : 'OFF'} [M]   BLUR ${starfield.motionBlur ? 'ON ' : 'OFF'} [B]   ${frameRate} FPS`;
	const bottom = canvas.height - 16;
	ctx.fillText(status, 16, bottom);
	ctx.fillStyle = hull <= LOW_HULL ? WARNING_ORANGE : PHOSPHOR_GREEN;
	ctx.fillText(hullText, 16 + ctx.measureText(status).width, bottom);
	ctx.fillStyle = PHOSPHOR_GREEN;
	// Controls on the right; up a line if the window is too narrow for both.
	const leftWidth = ctx.measureText(status + hullText).width;
	const fits = 16 + leftWidth + 40 + ctx.measureText(controls).width + 16 <= canvas.width;
	ctx.textAlign = 'right';
	ctx.fillText(controls, canvas.width - 16, fits ? bottom : bottom - 24);
}

// A hit: a quick green-white wash over everything.
function drawHitFlash() {
	if (flashTime > 0) {
		ctx.fillStyle = `rgba(170, 255, 180, ${(0.3 * flashTime / FLASH_TIME).toFixed(3)})`;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
}

function drawShipLost() {
	if (!shipLost) {
		return;
	}
	ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.textAlign = 'center';
	ctx.fillStyle = WARNING_ORANGE;
	ctx.font = '40px ui-monospace, Menlo, monospace';
	ctx.fillText('SHIP DESTROYED', canvas.width / 2, canvas.height / 2 - 10);
	ctx.fillStyle = PHOSPHOR_GREEN;
	ctx.font = '18px ui-monospace, Menlo, monospace';
	ctx.fillText(`KILLS ${kills}   —   PRESS ENTER OR CLICK TO FLY AGAIN`, canvas.width / 2, canvas.height / 2 + 30);
}

// --- Main loop --------------------------------------------------------------

let lastTime = null;

function frame(now) {
	// Clamp dt so a backgrounded tab doesn't produce one giant jump on return.
	const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	fps.startFrame();
	if (started) {
		turret.update(dt);
		for (const fighter of fighters) {
			fighter.update(dt);
		}
		guns.update(dt, turret);
		cannon?.update(dt);
		updateCombat(dt);
		updateShip(dt);
		sound.setListener(turret.axes());
		sound.updateEngines(fighters);
	}

	ctx.fillStyle = 'black';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Back to front: stars, things in space, cockpit, then the HUD on top.
	starfield.draw(ctx, camera, turret.viewMatrix(), dt);
	// Everything in space shares one depth sort, so bolts and wreckage pass in
	// front of or behind fighters correctly.
	drawModels(ctx, camera, [
		...worldModels,
		...fighters.map((fighter) => fighter.model),
		...explosions.flatMap((explosion) => explosion.models),
		...guns.models,
		...enemyFire.models,
	]);
	if (cannon) {
		drawModels(ctx, camera, cannon.models);
	}
	drawModels(ctx, camera, cockpitModels);
	drawReticle();
	for (const fighter of fighters) {
		drawOffscreenArrow(fighter.position);
	}
	drawMouseMarker();
	drawHitFlash();

	fps.endFrame();
	drawHUD(fps.fps());
	drawShipLost();

	requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
