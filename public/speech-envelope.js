// Audio-driven articulation, not phoneme recognition. No random mouth motion.
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : a));
export class SpeechEnvelope {
  constructor() { this.open = 0; this.form = .08; this.gate = false; this.quiet = 0; }
  step(rms, dt, active = true) {
    dt = clamp(dt, .001, .1); rms = clamp(rms, 0, 1);
    if (!active) { this.open = 0; this.form = .08; this.gate = false; this.quiet = 0; return this.value(); }
    // Hysteresis avoids chatter at the noise floor. A short release bridges
    // glottal cycles, but not pauses between phrases.
    if (rms >= .008) { this.gate = true; this.quiet = 0; }
    else if (rms < .0045) { this.quiet += dt; if (this.quiet >= .045) this.gate = false; }
    else this.quiet = 0;
    const target = this.gate ? clamp(Math.sqrt(Math.max(0, rms - .004) / .16) * .82, 0, .86) : 0;
    const tau = target > this.open ? .025 : .055;
    this.open += (target - this.open) * (1 - Math.exp(-dt / tau));
    if (!this.gate && this.open < .008) this.open = 0;
    // Small energy-dependent width variation; deliberately not labelled A/I/U.
    const form = .08 + this.open * .2;
    this.form += (form - this.form) * (1 - Math.exp(-dt / .09));
    return this.value();
  }
  value() { return { ParamMouthOpenY: this.open, ParamMouthForm: this.form }; }
}
