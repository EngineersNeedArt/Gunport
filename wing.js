// wing.js -- the enemy's fighters for one game, and when they arrive.
//
// A game is `waves` waves of `size` fighters. Within a wave the first fighter
// arrives straight away and the rest one at a time, `interval` seconds apart.
// There are no replacements: once every fighter of a wave has been shot down,
// the next wave arrives after a `pause`. Clear the last wave and the game is won.

export class Wing {
	wave = 1;		// the current wave, counting from 1
	sent = 0;		// fighters of this wave that have arrived so far
	#timer = 0;		// seconds until the next fighter (or wave) arrives

	constructor({ waves = 3, size = 4, interval = 4, pause = 3 } = {}) {
		this.waves = waves;
		this.size = size;
		this.interval = interval;
		this.pause = pause;
	}

	/** Start a new game's wing. */
	reset() {
		this.wave = 1;
		this.sent = 0;
		this.#timer = 0;
	}

	/**
	 * Call once a frame.
	 * @param {number} remaining - fighters still flying.
	 * @returns {boolean} true if a fighter should arrive now.
	 */
	update(dt, remaining) {
		if (this.waveSent) {
			if (remaining > 0 || this.finished) {
				return false;
			}
			// This wave is cleared: the next one comes after a pause.
			this.wave++;
			this.sent = 0;
			this.#timer = this.pause;
		}
		this.#timer -= dt;
		if (this.#timer > 0) {
			return false;
		}
		this.sent++;
		this.#timer = this.interval;
		return true;
	}

	/** Every fighter of the current wave has arrived. */
	get waveSent() {
		return this.sent >= this.size;
	}

	/** Every fighter of the last wave has arrived. */
	get finished() {
		return this.wave >= this.waves && this.waveSent;
	}

	/** Fighters in the whole game. */
	get total() {
		return this.waves * this.size;
	}
}
