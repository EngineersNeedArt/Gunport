// sound.js -- the game's sound, with the Web Audio API.
//
// Two kinds of sound:
//   - one-shots (lasers, explosions, hits): a sample is started and left to play
//     out, panned left/right and made quieter with distance from where it happened;
//   - fighter engines: one looping sample per fighter, playing the whole time it's
//     alive, continuously re-panned and re-levelled as it moves, muffled with
//     distance, and pitch-shifted by its speed toward or away from us (a Doppler
//     shift, exaggerated: the pitch drops as it roars past).
//
// THE SAMPLES are synthesized here at start-up (see the "Synthesis" section), so
// there are no sound files to ship. To use a recording instead, put the file's
// path in SAMPLE_FILES (any format the browser decodes: .wav, .mp3, .m4a...); the
// synthesized one is kept as a fallback if it fails to load.
//
// STARTING: browsers won't make sound until the page has been clicked or a key
// pressed, so the game calls start() from the intro screen's dismissal.
//
// Positions are in world space (+x right, +y up, +z straight out, the turret at
// the origin); setListener() gives the turret's current aim, for panning.

const SAMPLE_FILES = {
	laser: 'sounds/ShipBlaster.wav',			// our cannon, one pair of bolts
	enemyLaser: 'sounds/FighterBlaster.wav',	// a fighter's pair of bolts
	explosion: 'sounds/FighterExplosion.wav',	// a fighter destroyed
	clank: 'sounds/FighterHit.wav',				// a fighter hit but not destroyed
	hullHit: 'sounds/ShipHit.wav',				// an enemy bolt hitting our ship
	engine: 'sounds/FighterEngine.wav',			// a fighter's engine; LOOPED, so it must loop seamlessly
};

const MASTER_VOLUME = 0.6;
const DISTANCE_REFERENCE = 15;		// one-shots are at half volume this far away (unless play() says otherwise)
const ENGINE_REFERENCE = 12;		// engines fall off faster: (ref / (ref + d)) ^ 1.5
const ENGINE_VOLUME = 0.9;
const SPEED_OF_SOUND = 80;			// world units/second -- slow, to exaggerate the Doppler shift
const PAN_WIDTH = 0.85;				// how far to either side sounds can pan (1 = hard left/right)

export class Sound {
	enabled = true;
	#context = null;
	#master = null;
	#buffers = {};
	#engines = new Map();		// fighter -> { source, filter, gain, panner }
	#right = [1, 0, 0];			// the turret's aim, for panning
	#forward = [0, 0, 1];

	/** True once start() has run (after a click or key press). */
	get started() {
		return this.#context !== null;
	}

	/** Create the audio context. Call from a click or key press handler. */
	start() {
		if (this.#context) {
			this.#context.resume();
			return;
		}
		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextClass) {
			console.warn('No Web Audio in this browser: playing without sound');
			return;
		}
		this.#context = new AudioContextClass();
		this.#master = this.#context.createGain();
		this.#master.gain.value = this.enabled ? MASTER_VOLUME : 0;
		this.#master.connect(this.#context.destination);
		this.#context.resume();

		this.#buffers = synthesizeAll(this.#context);
		for (const [name, path] of Object.entries(SAMPLE_FILES)) {
			if (path) {
				this.#load(name, path);
			}
		}
	}

	toggle() {
		this.enabled = !this.enabled;
		if (this.#master) {
			const now = this.#context.currentTime;
			this.#master.gain.cancelScheduledValues(now);
			this.#master.gain.setTargetAtTime(this.enabled ? MASTER_VOLUME : 0, now, 0.05);
		}
	}

	/** The turret's aim, as unit vectors (see Turret.axes()). */
	setListener({ right, forward }) {
		this.#right = right;
		this.#forward = forward;
	}

	/**
	 * Play a one-shot sample.
	 * @param {string} name - a key of SAMPLE_FILES.
	 * @param {object} [options]
	 * @param {number[]} [options.position] - where it happened (world); omit for "right here".
	 * @param {number} [options.volume] - 0..1 before distance.
	 * @param {number} [options.rate] - playback speed (1 = as recorded; also shifts pitch).
	 * @param {number} [options.falloff] - distance at which it's at half volume (bigger
	 *     carries further); defaults to DISTANCE_REFERENCE. Infinity: the same volume
	 *     at any distance (still panned).
	 */
	play(name, { position = null, volume = 1, rate = 1, falloff = DISTANCE_REFERENCE } = {}) {
		if (!this.#context || !this.enabled || !this.#buffers[name]) {
			return;
		}
		const ctx = this.#context;
		const source = ctx.createBufferSource();
		source.buffer = this.#buffers[name];
		source.playbackRate.value = rate;
		const gain = ctx.createGain();
		const panner = ctx.createStereoPanner();
		if (position) {
			const distance = Math.hypot(...position);
			gain.gain.value = falloff === Infinity ? volume : volume * falloff / (falloff + distance);
			panner.pan.value = this.#pan(position);
		} else {
			gain.gain.value = volume;
		}
		source.connect(gain).connect(panner).connect(this.#master);
		source.start();
	}

	/**
	 * Keep one engine loop per fighter, panned, levelled and pitched to its flight.
	 * @param {Array} fighters - each with position, velocity and range.
	 */
	updateEngines(fighters) {
		if (!this.#context || !this.#buffers.engine) {
			return;
		}
		const ctx = this.#context;
		const now = ctx.currentTime;
		for (const fighter of fighters) {
			let engine = this.#engines.get(fighter);
			if (!engine) {
				engine = this.#startEngine();
				this.#engines.set(fighter, engine);
			}
			const distance = Math.max(fighter.range, 0.5);
			const level = ENGINE_VOLUME * Math.pow(ENGINE_REFERENCE / (ENGINE_REFERENCE + distance), 1.5);
			// Speed away from us (+) or toward us (-), for the Doppler shift.
			const away = fighter.velocity.reduce((sum, v, i) => sum + v * fighter.position[i], 0) / distance;
			const rate = SPEED_OF_SOUND / Math.max(SPEED_OF_SOUND * 0.3, SPEED_OF_SOUND + away);
			// Distant engines lose their top end.
			const cutoff = 600 + 9000 * ENGINE_REFERENCE / (ENGINE_REFERENCE + distance);
			// Short smoothing times: follows the flight without zipper noise.
			engine.gain.gain.setTargetAtTime(level, now, 0.05);
			engine.panner.pan.setTargetAtTime(this.#pan(fighter.position), now, 0.05);
			engine.source.playbackRate.setTargetAtTime(rate, now, 0.08);
			engine.filter.frequency.setTargetAtTime(cutoff, now, 0.08);
		}
		// Fighters that are gone (shot down): fade their engines out.
		for (const [fighter, engine] of this.#engines) {
			if (!fighters.includes(fighter)) {
				engine.gain.gain.setTargetAtTime(0, now, 0.04);
				engine.source.stop(now + 0.3);
				this.#engines.delete(fighter);
			}
		}
	}

	#startEngine() {
		const ctx = this.#context;
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		const gain = ctx.createGain();
		gain.gain.value = 0;
		const panner = ctx.createStereoPanner();
		filter.connect(gain).connect(panner).connect(this.#master);
		const engine = { source: null, filter, gain, panner };
		this.#startEngineLoop(engine, 1);
		return engine;
	}

	// (Re)start an engine's looping sample with the current engine buffer.
	#startEngineLoop(engine, rate) {
		const source = this.#context.createBufferSource();
		source.buffer = this.#buffers.engine;
		source.loop = true;
		source.playbackRate.value = rate;
		source.connect(engine.filter);
		// Start each loop at a random point so several engines don't sound in unison.
		source.start(0, Math.random() * source.buffer.duration);
		engine.source = source;
	}

	// A recording finished loading after engines were already running (the first
	// fighter appears before the file arrives): switch them over to it.
	#swapEngineLoops() {
		for (const engine of this.#engines.values()) {
			const old = engine.source;
			this.#startEngineLoop(engine, old.playbackRate.value);
			old.stop();
		}
	}

	// -1 (left) .. 1 (right), from where `position` is relative to the aim.
	#pan(position) {
		const distance = Math.hypot(...position) || 1;
		const side = (position[0] * this.#right[0] + position[1] * this.#right[1] + position[2] * this.#right[2]) / distance;
		return Math.max(-1, Math.min(1, side)) * PAN_WIDTH;
	}

	async #load(name, path) {
		try {
			const response = await fetch(path);
			if (!response.ok) {
				throw new Error(`${response.status}`);
			}
			this.#buffers[name] = await this.#context.decodeAudioData(await response.arrayBuffer());
			console.info(`Sound "${name}": using ${path}`);
			if (name === 'engine') {
				this.#swapEngineLoops();
			}
		} catch (error) {
			console.warn(`Couldn't load sound ${path} (${error.message}); using the built-in one`);
		}
	}
}

// --- Synthesis --------------------------------------------------------------
// Each sound is built sample by sample into an AudioBuffer: oscillators swept
// in pitch, filtered noise, and simple decaying envelopes.

function synthesizeAll(ctx) {
	return {
		laser: laser(ctx, { from: 1700, to: 260, seconds: 0.16, buzz: 0.55, noise: 0.15 }),
		enemyLaser: laser(ctx, { from: 950, to: 180, seconds: 0.24, buzz: 0.9, noise: 0.25 }),
		explosion: explosion(ctx),
		clank: clank(ctx),
		hullHit: hullHit(ctx),
		engine: engine(ctx),
	};
}

function makeBuffer(ctx, seconds, generate) {
	const rate = ctx.sampleRate;
	const length = Math.round(seconds * rate);
	const buffer = ctx.createBuffer(1, length, rate);
	const data = buffer.getChannelData(0);
	generate(data, rate);
	normalize(data, 0.9);
	return buffer;
}

function normalize(data, peak) {
	let max = 0;
	for (const v of data) {
		max = Math.max(max, Math.abs(v));
	}
	if (max > 0) {
		for (let i = 0; i < data.length; i++) {
			data[i] *= peak / max;
		}
	}
}

// A one-pole low-pass filter, step by step: returns a function sample -> filtered.
function lowpass(cutoff, rate) {
	let state = 0;
	return (input, newCutoff = cutoff) => {
		const a = 1 - Math.exp(-2 * Math.PI * newCutoff / rate);
		state += a * (input - state);
		return state;
	};
}

const noise = () => Math.random() * 2 - 1;

// A zap: a tone sweeping down fast in pitch, part sine, part buzzy square, with a
// hiss on the attack.
function laser(ctx, { from, to, seconds, buzz, noise: hiss }) {
	return makeBuffer(ctx, seconds, (data, rate) => {
		let phase = 0;
		for (let i = 0; i < data.length; i++) {
			const t = i / rate;
			const progress = t / seconds;
			const frequency = from * Math.pow(to / from, Math.pow(progress, 0.6));
			phase += frequency / rate;
			const sine = Math.sin(2 * Math.PI * phase);
			const square = Math.sign(sine);
			const envelope = Math.min(1, t / 0.003) * Math.pow(1 - progress, 1.8);
			const attackHiss = hiss * noise() * Math.exp(-t / 0.02);
			data[i] = envelope * ((1 - buzz) * sine + buzz * 0.5 * square + attackHiss);
		}
	});
}

// A boom: noise through a filter that closes as it dies away, plus a low thump.
function explosion(ctx) {
	const seconds = 1.6;
	return makeBuffer(ctx, seconds, (data, rate) => {
		const filter = lowpass(3000, rate);
		let phase = 0;
		for (let i = 0; i < data.length; i++) {
			const t = i / rate;
			const crackle = Math.random() < 0.002 ? noise() * 3 : 0;	// bits of debris
			const rumble = filter(noise() + crackle, 200 + 3500 * Math.exp(-t / 0.25));
			const envelope = Math.min(1, t / 0.005) * Math.exp(-t / 0.45);
			phase += (35 + 40 * Math.exp(-t / 0.1)) / rate;
			const thump = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.18);
			data[i] = envelope * rumble * 2.5 + thump * 0.8;
		}
	});
}

// A metallic hit: a few inharmonic partials ringing briefly, with a click.
function clank(ctx) {
	const seconds = 0.35;
	const partials = [[520, 1], [1370, 0.6], [2290, 0.4], [3810, 0.25]];
	return makeBuffer(ctx, seconds, (data, rate) => {
		for (let i = 0; i < data.length; i++) {
			const t = i / rate;
			let ring = 0;
			for (const [frequency, amplitude] of partials) {
				ring += amplitude * Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t * frequency / 900);
			}
			data[i] = ring + noise() * Math.exp(-t / 0.004);
		}
	});
}

// Our ship taking a hit: a heavy low thud, a burst of crunch, and a ringing tail.
function hullHit(ctx) {
	const seconds = 0.7;
	return makeBuffer(ctx, seconds, (data, rate) => {
		const filter = lowpass(1500, rate);
		let phase = 0;
		for (let i = 0; i < data.length; i++) {
			const t = i / rate;
			phase += (55 + 60 * Math.exp(-t / 0.05)) / rate;
			const thud = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.15);
			const crunch = filter(noise(), 400 + 2500 * Math.exp(-t / 0.08)) * Math.exp(-t / 0.12) * 3;
			const ring = Math.sin(2 * Math.PI * 180 * t) * Math.sin(2 * Math.PI * 263 * t) * Math.exp(-t / 0.3) * 0.4;
			data[i] = Math.min(1, t / 0.002) * (thud + crunch + ring);
		}
	});
}

// A fighter's engine: a rough, wavering howl -- two slightly detuned buzzy tones
// beating against each other, a higher whine, and band-limited rushing noise that
// flutters. Two seconds long and seamless when looped: every frequency here
// completes a whole number of cycles in that time, and the noise's ends are
// cross-faded together.
function engine(ctx) {
	const seconds = 2;
	const fade = 0.1;		// seconds of noise cross-fade at the loop point
	return makeBuffer(ctx, seconds, (data, rate) => {
		const length = data.length;
		const fadeLength = Math.round(fade * rate);
		// Band-limited noise for the whole loop plus the cross-fade overhang.
		const low = lowpass(2200, rate);
		const lower = lowpass(350, rate);
		const hiss = new Float32Array(length + fadeLength);
		for (let i = 0; i < hiss.length; i++) {
			const n = noise();
			hiss[i] = low(n) - lower(n);
		}
		for (let i = 0; i < fadeLength; i++) {
			const mix = i / fadeLength;
			hiss[i] = hiss[i] * mix + hiss[length + i] * (1 - mix);
		}

		const saw = (frequency, t) => 2 * ((t * frequency) % 1) - 1;
		for (let i = 0; i < length; i++) {
			const t = i / rate;
			const flutter = 0.6 + 0.4 * Math.sin(2 * Math.PI * 7 * t);
			const growl = 0.35 * (saw(87, t) + saw(87.5, t)) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 1.5 * t));
			const whine = 0.18 * Math.sin(2 * Math.PI * 611 * t + 0.6 * Math.sin(2 * Math.PI * 3 * t));
			data[i] = growl + whine + 2.2 * hiss[i] * flutter;
		}
	});
}
