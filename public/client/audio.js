// Áudio sintetizado (WebAudio), sem arquivos externos.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  tone(freq, dur, type = 'square', gain = 0.3, slideTo = null, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, gain = 0.2, cutoff = 1200, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name) {
    if (!this.enabled) return;
    switch (name) {
      case 'hit':
        this.tone(180, 0.08, 'square', 0.25, 90);
        this.noise(0.06, 0.18, 2400);
        break;
      case 'weak':
        this.tone(320, 0.12, 'triangle', 0.28, 520);
        this.tone(640, 0.1, 'sine', 0.18, 900, 0.02);
        break;
      case 'hurt':
        this.tone(120, 0.18, 'sawtooth', 0.28, 50);
        this.noise(0.12, 0.22, 800);
        break;
      case 'dash':
        this.noise(0.09, 0.12, 3000);
        break;
      case 'shoot':
        this.tone(600, 0.06, 'square', 0.16, 300);
        break;
      case 'pickup':
        this.tone(520, 0.07, 'square', 0.2);
        this.tone(780, 0.09, 'square', 0.2, null, 0.06);
        break;
      case 'coin':
        this.tone(880, 0.05, 'square', 0.14);
        this.tone(1180, 0.07, 'square', 0.12, null, 0.04);
        break;
      case 'checkpoint':
        this.tone(392, 0.2, 'sine', 0.22);
        this.tone(523, 0.22, 'sine', 0.22, null, 0.12);
        this.tone(784, 0.35, 'sine', 0.2, null, 0.24);
        break;
      case 'revive':
        this.tone(330, 0.15, 'triangle', 0.24);
        this.tone(440, 0.15, 'triangle', 0.24, null, 0.1);
        this.tone(660, 0.3, 'triangle', 0.22, null, 0.2);
        break;
      case 'downed':
        this.tone(160, 0.4, 'sawtooth', 0.3, 60);
        break;
      case 'death':
        this.tone(90, 0.7, 'sawtooth', 0.3, 35);
        break;
      case 'explosion':
        this.noise(0.4, 0.5, 600);
        this.tone(70, 0.4, 'sawtooth', 0.3, 30);
        break;
      case 'grapple':
        this.tone(300, 0.12, 'square', 0.15, 700);
        break;
      case 'deny':
        this.tone(140, 0.12, 'square', 0.16, 110);
        break;
      case 'door':
        this.tone(220, 0.2, 'sine', 0.2);
        this.tone(330, 0.25, 'sine', 0.18, null, 0.1);
        break;
      case 'boss':
        this.tone(60, 1.2, 'sawtooth', 0.3, 40);
        this.noise(0.8, 0.25, 300);
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.24, null, i * 0.14));
        break;
      case 'trade':
        this.tone(660, 0.1, 'triangle', 0.2);
        this.tone(880, 0.16, 'triangle', 0.18, null, 0.08);
        break;
      case 'ping':
        this.tone(980, 0.06, 'sine', 0.18);
        this.tone(980, 0.06, 'sine', 0.14, null, 0.1);
        break;
      default:
        break;
    }
  }
}
