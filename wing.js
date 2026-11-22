// wing.js -- the enemy's fighters for one game, and when they arrive.
//
// A game is one wing of `size` fighters. The first arrives straight away, the
// rest one at a time, `interval` seconds apart. There are no replacements:
// shoot them all down and the game is won.

export class Wing {
	sent = 0;		// fighters that have arrived so far this game
	#timer = 0;		// seconds until the next one arrives

	constructor({ size = 4, interval = 4 } = {}) {
		this.size = size;
		this.interval = interval;
	}

	/** Start a new game's wing. */
	reset() {
		this.sent = 0;
		this.#timer = 0;
	}

	/**
	 * Call once a frame.
	 * @returns {boolean} true if a fighter should arrive now.
	 */
	update(dt) {
		if (this.allSent) {
			return false;
		}
		this.#timer -= dt;
		if (this.#timer > 0) {
			return false;
		}
		this.sent++;
		this.#timer = this.interval;
		return true;
	}

	get allSent() {
		return this.sent >= this.size;
	}
}
