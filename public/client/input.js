// Entrada: teclado + gamepad. As teclas de ação geram "edge" (um pulso),
// que é exatamente o que o servidor espera.

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyJ', 'KeyK', 'KeyE', 'Digit1', 'Digit2', 'KeyI', 'KeyH', 'KeyQ',
]);

export class Input {
  constructor() {
    this.held = new Set();
    this.edges = { dash: false, attack: false, interact: false, use1: false, use2: false };
    this.taps = []; // teclas de interface pressionadas neste frame
    this.gpPrev = [];
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.taps.push(e.code);
      switch (e.code) {
        case 'Space': this.edges.dash = true; break;
        case 'KeyJ': this.edges.attack = true; break;
        case 'KeyE': this.edges.interact = true; break;
        case 'Digit1': this.edges.use1 = true; break;
        case 'Digit2': this.edges.use2 = true; break;
        default: break;
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Retorna o estado de movimento + pulsos deste passo fixo. */
  sample() {
    let mx = 0;
    let my = 0;
    const h = this.held;
    if (h.has('KeyA') || h.has('ArrowLeft')) mx -= 1;
    if (h.has('KeyD') || h.has('ArrowRight')) mx += 1;
    if (h.has('KeyW') || h.has('ArrowUp')) my -= 1;
    if (h.has('KeyS') || h.has('ArrowDown')) my += 1;
    let block = h.has('KeyK');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (gp) {
      const dz = 0.28;
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      if (Math.abs(ax) > dz) mx = ax;
      if (Math.abs(ay) > dz) my = ay;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      block = block || b(3) || b(7);
      const prev = this.gpPrev;
      const edge = (i) => b(i) && !prev[i];
      if (edge(0)) this.edges.attack = true;
      if (edge(1) || edge(5)) this.edges.dash = true;
      if (edge(2)) this.edges.interact = true;
      if (edge(4)) this.edges.use1 = true;
      if (edge(6)) this.edges.use2 = true;
      if (edge(9)) this.taps.push('KeyI');
      this.gpPrev = gp.buttons.map((x) => x.pressed);
    }

    if (!this.enabled) {
      mx = 0;
      my = 0;
      block = false;
    }

    const out = {
      mx,
      my,
      block,
      dash: this.edges.dash,
      attack: this.edges.attack,
      interact: this.edges.interact,
      use1: this.edges.use1,
      use2: this.edges.use2,
    };
    this.edges = { dash: false, attack: false, interact: false, use1: false, use2: false };
    return out;
  }

  takeTaps() {
    const t = this.taps;
    this.taps = [];
    return t;
  }
}
