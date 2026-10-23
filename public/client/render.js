// Renderizador 2D em pixel art procedural, 320x180, sem assets externos.
// Todas as cores vêm das paletas dos 4 biomas definidas em shared/constants.js.

import { BIOMES, KITS, ITEM_DEFS, VIEW_W, VIEW_H, TILE } from '/shared/constants.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const WALL_STYLE = {
  forest: { base: '#3a2f22', top: '#5a4632', edge: '#1b2a1c', accent: '#6bbf6e', crack: '#8a6b4a' },
  cave: { base: '#241a38', top: '#3a2e52', edge: '#120d1f', accent: '#8a5cff', crack: '#57477a' },
  desert: { base: '#6b4a3a', top: '#a67c52', edge: '#3a2418', accent: '#ffd166', crack: '#c99a6a' },
  swamp: { base: '#22302a', top: '#354a3a', edge: '#0e1812', accent: '#6e8f4a', crack: '#4c6b3a' },
};

const HEART_PX = [
  [0, 1, 0, 1, 0],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
  [0, 0, 1, 0, 0],
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.particles = [];
    this.pings = [];
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.damageFlash = 0;
    this.decor = new Map();
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = VIEW_W;
    this.fogCanvas.height = VIEW_H;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.time = 0;
  }

  setRoom(room) {
    this.room = room;
  }

  burst(x, y, n, color, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed || 60) * (0.3 + Math.random());
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opts.up || 0),
        life: (opts.life || 0.45) * (0.6 + Math.random() * 0.7),
        max: opts.life || 0.45,
        color: Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color,
        size: opts.size || (Math.random() < 0.3 ? 2 : 1),
        gravity: opts.gravity || 0,
        glow: opts.glow || false,
      });
    }
  }

  ring(x, y, color, r = 18, life = 0.35) {
    this.particles.push({ x, y, ring: true, r0: 2, r1: r, life, max: life, color, line: 2 });
  }

  event(ev) {
    switch (ev.type) {
      case 'hit':
        this.burst(ev.x, ev.y, ev.weak ? 16 : 9,
          ev.weak ? ['#fff6c9', '#ffd166', '#ff8a4c'] : ['#ffffff', '#c7a8ff', '#ffd166'],
          { speed: 90, life: 0.35, glow: true });
        this.ring(ev.x, ev.y, ev.weak ? '#ffd166' : '#ffffff', ev.weak ? 16 : 10, 0.22);
        this.shake = Math.max(this.shake, ev.weak ? 4 : 2);
        if (ev.weak) this.burst(ev.x, ev.y, 5, '#fff6c9', { speed: 30, up: 20, life: 0.7, glow: true });
        break;
      case 'hurt':
        this.burst(ev.x, ev.y, 12, ['#ff5d5d', '#ffb0b0', '#8a1f1f'], { speed: 80, life: 0.5 });
        this.damageFlash = 0.6;
        this.shake = Math.max(this.shake, 5);
        break;
      case 'kill':
        this.burst(ev.x, ev.y, ev.kind === 'boss' ? 60 : 22,
          ['#ffd166', '#ff8a4c', '#ffffff', '#9bf6a3'], { speed: 110, life: 0.8, glow: true });
        this.ring(ev.x, ev.y, '#ffd166', ev.kind === 'boss' ? 70 : 24, 0.5);
        this.shake = Math.max(this.shake, ev.kind === 'boss' ? 9 : 3);
        break;
      case 'pickup':
        this.burst(ev.x, ev.y, 10, ['#fff6c9', '#ffd166'], { speed: 40, up: 30, life: 0.6, glow: true });
        break;
      case 'coin':
        this.burst(ev.x, ev.y, 5, '#ffd166', { speed: 40, up: 25, life: 0.5, glow: true });
        break;
      case 'shoot':
        this.burst(ev.x, ev.y, 4, ev.kind === 'acid' ? '#9bf6a3' : ev.kind === 'dagger' ? '#ff8a4c' : '#c7a8ff',
          { speed: 40, life: 0.25, glow: true });
        break;
      case 'swing':
        this.burst(ev.x + ev.fx * 14, ev.y + ev.fy * 14, 5, ['#ffffff', '#bff3ff'], { speed: 45, life: 0.18 });
        break;
      case 'explosion':
        this.burst(ev.x, ev.y, 34, ['#fff6c9', '#ffd166', '#ff8a4c', '#ff5d5d'], { speed: 150, life: 0.7, glow: true });
        this.ring(ev.x, ev.y, '#ffd166', 46, 0.45);
        this.shake = Math.max(this.shake, 8);
        break;
      case 'wall_break':
        this.burst(ev.x + ev.w / 2, ev.y + ev.h / 2, 30, ['#8a6b4a', '#5a4632', '#ffd166'], { speed: 90, life: 0.9 });
        break;
      case 'checkpoint':
        this.burst(ev.x, ev.y - 12, 20, ['#9bf6a3', '#ffffff', '#6bbf6e'], { speed: 40, up: 30, life: 1, glow: true });
        this.ring(ev.x, ev.y, '#9bf6a3', 30, 0.6);
        break;
      case 'revive':
        this.burst(ev.x, ev.y, 24, ['#9bf6a3', '#ffffff'], { speed: 50, up: 40, life: 0.9, glow: true });
        this.ring(ev.x, ev.y, '#9bf6a3', 28, 0.6);
        break;
      case 'downed':
        this.burst(ev.x, ev.y, 16, ['#ff5d5d', '#8a1f1f'], { speed: 70, life: 0.7 });
        this.shake = Math.max(this.shake, 5);
        break;
      case 'fall':
        this.burst(ev.x, ev.y, 12, ['#8c5a2e', '#5a4632'], { speed: 60, life: 0.6 });
        break;
      case 'teleport':
        break;
      case 'tongue':
        this.burst(ev.to.x, ev.to.y, 8, ['#b6ff6b', '#c77dff'], { speed: 40, life: 0.4, glow: true });
        break;
      case 'tongue_break':
        this.burst(ev.x, ev.y, 18, ['#b6ff6b', '#ffffff'], { speed: 80, life: 0.5, glow: true });
        this.ring(ev.x, ev.y, '#b6ff6b', 22, 0.35);
        break;
      case 'weak':
        this.ring(ev.x, ev.y, '#fff6c9', 18, 0.3);
        break;
      case 'boss_phase':
        this.burst(ev.x, ev.y, 40, ['#c77dff', '#9bf6a3', '#ffffff'], { speed: 120, life: 1, glow: true });
        this.shake = Math.max(this.shake, 8);
        break;
      case 'shockwave':
        this.ring(ev.x, ev.y, '#c77dff', 60, 0.4);
        this.shake = Math.max(this.shake, 7);
        break;
      case 'grapple':
        this.burst(ev.x, ev.y, 8, ['#ff8a4c', '#ffffff'], { speed: 50, life: 0.3 });
        break;
      case 'bomb_place':
        this.burst(ev.x, ev.y, 6, ['#ffd166', '#8a6b4a'], { speed: 30, life: 0.4 });
        break;
      case 'transition':
        this.shake = 0;
        break;
      default:
        break;
    }
  }

  ping(x, y, kind, id) {
    this.pings.push({ x, y, kind, t: 0, life: 2.6, id });
  }

  update(dt) {
    this.time += dt;
    const parts = this.particles;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.ring) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    this.shake = Math.max(0, this.shake - dt * 26);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    const s = this.shake;
    this.shakeX = s > 0 ? (Math.random() * 2 - 1) * s : 0;
    this.shakeY = s > 0 ? (Math.random() * 2 - 1) * s : 0;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].t += dt;
      if (this.pings[i].t > this.pings[i].life) this.pings.splice(i, 1);
    }
  }

  // --------------------------------------------------------------- desenho
  draw(state) {
    const ctx = this.ctx;
    const room = state.room || this.room;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    if (!room) return;

    const biome = BIOMES[room.biome] || BIOMES.forest;
    const cam = state.camera;

    // chão do bioma (fora da transformação para cobrir a tela)
    ctx.fillStyle = biome.palette.ground;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(VIEW_W / 2 + this.shakeX, VIEW_H / 2 + this.shakeY);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    this.drawFloor(ctx, room, biome, cam);
    this.drawAmbient(ctx, room, biome, cam);
    this.drawHazards(ctx, room, biome);
    this.drawCheckpoint(ctx, state, biome);
    this.drawItems(ctx, state, biome);
    this.drawPools(ctx, state);
    this.drawDoors(ctx, state, biome);
    this.drawSolids(ctx, room, biome);
    this.drawParticles(ctx);

    const sorted = [...state.enemies].sort((a, b) => a.y - b.y);
    for (const e of sorted) this.drawEnemy(ctx, e, biome, state);
    for (const p of state.players) this.drawPlayer(ctx, p, state, p.id === state.myId);

    this.drawProjectiles(ctx, state);
    this.drawPings(ctx);

    ctx.restore();

    this.drawFog(ctx, state, biome);
    this.drawVignette(ctx, biome, state);
    this.drawHUD(ctx, state, biome);
  }

  drawFloor(ctx, room, biome, cam) {
    const p = biome.palette;
    // variação de terreno em blocos de 32px
    const rng = mulberry32(room.decorSeed || 7);
    ctx.fillStyle = p.ground;
    ctx.fillRect(0, 0, room.w, room.h);

    for (let y = 0; y < room.h; y += 32) {
      for (let x = 0; x < room.w; x += 32) {
        const v = rng();
        if (v < 0.18) {
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = v < 0.09 ? p.groundTop : p.sky1;
          ctx.fillRect(x + (v * 20) | 0, y + (v * 18) | 0, 10 + ((v * 14) | 0), 6 + ((v * 9) | 0));
          ctx.globalAlpha = 1;
        }
      }
    }

    // detalhes por bioma
    if (room.biome === 'forest') {
      ctx.strokeStyle = p.foliage;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const x = rng() * room.w;
        const y = rng() * room.h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 4 + rng() * 6, y - 2 - rng() * 4);
        ctx.stroke();
      }
    } else if (room.biome === 'cave') {
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 18; i++) {
        const x = rng() * room.w;
        const y = rng() * room.h;
        ctx.fillStyle = rng() < 0.5 ? p.foliage : p.leaf;
        ctx.fillRect(x, y, 2, 2);
      }
    } else if (room.biome === 'desert') {
      ctx.strokeStyle = p.foliage;
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < 12; i++) {
        const y = (i / 12) * room.h + 6;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x < room.w; x += 16) {
          ctx.lineTo(x, y + Math.sin((x + i * 20) * 0.03) * 3);
        }
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < 22; i++) {
        ctx.fillStyle = i % 3 === 0 ? p.water : p.foliage;
        const x = rng() * room.w;
        const y = rng() * room.h;
        ctx.beginPath();
        ctx.ellipse(x, y, 6 + rng() * 12, 3 + rng() * 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawAmbient(ctx, room, biome, cam) {
    const t = this.time;
    const p = biome.palette;
    ctx.save();
    if (room.biome === 'forest') {
      // raios de sol
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const x = ((i * 137 + t * 4) % (room.w + 200)) - 100;
        ctx.fillStyle = 'rgba(242,230,168,0.045)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 40, 0);
        ctx.lineTo(x + 90, room.h);
        ctx.lineTo(x + 30, room.h);
        ctx.fill();
      }
      // vagalumes
      for (let i = 0; i < 16; i++) {
        const x = ((i * 91) % room.w) + Math.sin(t * 0.6 + i) * 16;
        const y = ((i * 53) % room.h) + Math.cos(t * 0.5 + i * 1.7) * 12;
        ctx.fillStyle = i % 3 === 0 ? '#fff6c9' : p.leafLight;
        ctx.globalAlpha = 0.4 + Math.sin(t * 2 + i) * 0.3;
        ctx.fillRect(x, y, 1, 1);
      }
    } else if (room.biome === 'cave') {
      // brilho de cristais
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        const x = (i * 173) % room.w;
        const y = (i * 97) % room.h;
        const r = 16 + Math.sin(t * 1.4 + i) * 4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(138,92,255,0.20)');
        g.addColorStop(1, 'rgba(138,92,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // poeira cintilante
      for (let i = 0; i < 20; i++) {
        const x = (i * 61 + t * 6) % room.w;
        const y = (i * 37 + Math.sin(t + i) * 8) % room.h;
        ctx.fillStyle = i % 4 === 0 ? '#59e0e0' : p.leafLight;
        ctx.globalAlpha = 0.35 + Math.sin(t * 3 + i) * 0.25;
        ctx.fillRect(x, y, 1, 1);
      }
    } else if (room.biome === 'desert') {
      // poeira ao vento
      for (let i = 0; i < 26; i++) {
        const x = (i * 47 + t * 22) % (room.w + 40) - 20;
        const y = (i * 83 + Math.sin(t * 0.8 + i) * 10) % room.h;
        ctx.fillStyle = p.leafLight;
        ctx.globalAlpha = 0.12 + Math.sin(t + i) * 0.08;
        ctx.fillRect(x, y, 2, 1);
      }
      // miragem
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#fff0c2';
      for (let i = 0; i < 5; i++) {
        const y = ((i * 67 + t * 8) % room.h);
        ctx.fillRect(0, y, room.w, 2);
      }
    } else {
      // névoa em bandas
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const y = ((i * 79 + t * 6) % (room.h + 80)) - 40;
        ctx.fillStyle = 'rgba(168,192,160,0.05)';
        ctx.fillRect(0, y, room.w, 26);
      }
      // bolhas e vaga-lumes tóxicos
      for (let i = 0; i < 18; i++) {
        const x = (i * 71) % room.w;
        const y = room.h - ((t * 14 + i * 43) % room.h);
        ctx.fillStyle = i % 5 === 0 ? '#c77dff' : '#9bf6a3';
        ctx.globalAlpha = 0.35 + Math.sin(t * 2 + i) * 0.25;
        ctx.fillRect(x + Math.sin(t + i) * 3, y, 1, 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  drawHazards(ctx, room, biome) {
    const t = this.time;
    for (const h of room.hazards || []) {
      if (h.type === 'pit') {
        ctx.fillStyle = '#0a0806';
        ctx.fillRect(h.x, h.y, h.w, h.h);
        ctx.strokeStyle = biome.palette.far;
        ctx.lineWidth = 2;
        ctx.strokeRect(h.x + 1, h.y + 1, h.w - 2, h.h - 2);
        // estacas no fundo
        ctx.fillStyle = '#1a1510';
        for (let x = h.x + 8; x < h.x + h.w; x += 14) {
          ctx.beginPath();
          ctx.moveTo(x, h.y + h.h - 4);
          ctx.lineTo(x + 3, h.y + h.h - 14);
          ctx.lineTo(x + 6, h.y + h.h - 4);
          ctx.fill();
        }
      } else if (h.type === 'poison') {
        ctx.fillStyle = 'rgba(155,246,163,0.18)';
        ctx.fillRect(h.x, h.y, h.w, h.h);
        ctx.strokeStyle = '#9bf6a3';
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.strokeRect(h.x + 0.5, h.y + 0.5, h.w - 1, h.h - 1);
        for (let i = 0; i < 6; i++) {
          const x = h.x + ((i * 29 + t * 8) % h.w);
          const y = h.y + ((i * 19 + t * 12) % h.h);
          ctx.fillStyle = '#b6ff6b';
          ctx.globalAlpha = 0.35 + Math.sin(t * 3 + i) * 0.25;
          ctx.fillRect(x, y, 2, 2);
        }
        ctx.globalAlpha = 1;
      } else if (h.type === 'spikes') {
        ctx.fillStyle = '#b0c4cc';
        for (let x = h.x + 4; x < h.x + h.w; x += 8) {
          ctx.beginPath();
          ctx.moveTo(x, h.y + h.h);
          ctx.lineTo(x + 4, h.y + 2);
          ctx.lineTo(x + 8, h.y + h.h);
          ctx.fill();
        }
      }
    }
  }

  drawSolids(ctx, room, biome) {
    const st = WALL_STYLE[room.biome];
    for (const s of room.solids) {
      ctx.fillStyle = st.base;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = st.top;
      ctx.fillRect(s.x, s.y, s.w, Math.min(5, s.h));
      ctx.fillStyle = st.edge;
      ctx.fillRect(s.x, s.y + s.h - 2, s.w, 2);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(s.x + s.w - 2, s.y, 2, s.h);
      ctx.globalAlpha = 1;

      // textura
      if (s.w > 24 && s.h > 24) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = st.top;
        for (let y = s.y + 8; y < s.y + s.h - 4; y += 10) {
          ctx.fillRect(s.x + 2, y, s.w - 4, 1);
        }
        ctx.globalAlpha = 1;
      }

      // musgo / cristal / detalhe
      if (room.biome === 'forest' || room.biome === 'swamp') {
        ctx.fillStyle = st.accent;
        ctx.globalAlpha = 0.55;
        for (let x = s.x + 2; x < s.x + s.w - 2; x += 7) {
          if ((x * 7 + s.y) % 13 < 6) ctx.fillRect(x, s.y - 1, 3, 2);
        }
        ctx.globalAlpha = 1;
      }

      if (s.breakable) {
        ctx.strokeStyle = st.crack;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x + s.w * 0.3, s.y + 4);
        ctx.lineTo(s.x + s.w * 0.65, s.y + s.h * 0.35);
        ctx.lineTo(s.x + s.w * 0.4, s.y + s.h * 0.6);
        ctx.lineTo(s.x + s.w * 0.7, s.y + s.h - 4);
        ctx.stroke();
        // ícone de bomba
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(cx - 6, cy - 6, 12, 12);
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(cx, cy + 1, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx, cy - 4, 1, 3);
      }
    }
  }

  drawDoors(ctx, state, biome) {
    const room = state.room;
    for (const d of room.doors || []) {
      const p = biome.palette;
      const locked = d.needs === 'key_big' && state.world.keys <= 0;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = locked ? '#2a1515' : p.sky0;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = locked ? '#ff5d5d' : p.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(d.x + 1, d.y + 1, d.w - 2, d.h - 2);
      // seta indicando a saída
      ctx.fillStyle = locked ? '#ff9b9b' : p.accent;
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - 7);
      ctx.lineTo(cx + 6, cy);
      ctx.lineTo(cx - 4, cy + 7);
      ctx.fill();
      if (locked) {
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(cx - 6, cy - 2, 12, 9);
        ctx.strokeStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(cx, cy - 3, 4, Math.PI, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawCheckpoint(ctx, state, biome) {
    const room = state.room;
    if (!room.checkpoint) return;
    const c = room.checkpoint;
    const active = state.world.checkpoint && state.world.checkpoint.room === state.roomIndex;
    const t = this.time;

    // base
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(c.x - 9, c.y - 2, 18, 8);
    ctx.fillStyle = '#565664';
    ctx.fillRect(c.x - 7, c.y - 4, 14, 4);
    // estátua
    ctx.fillStyle = active ? '#8a7a5a' : '#4a4a55';
    ctx.fillRect(c.x - 5, c.y - 18, 10, 15);
    ctx.fillStyle = active ? '#b0a074' : '#5c5c68';
    ctx.fillRect(c.x - 3, c.y - 16, 6, 11);

    if (active) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(c.x, c.y - 22, 0, c.x, c.y - 22, 22);
      g.addColorStop(0, 'rgba(155,246,163,0.55)');
      g.addColorStop(1, 'rgba(155,246,163,0)');
      ctx.fillStyle = g;
      ctx.fillRect(c.x - 24, c.y - 46, 48, 48);
      ctx.globalCompositeOperation = 'source-over';
      // chama
      const f = 1 + Math.sin(t * 9) * 0.2;
      ctx.fillStyle = '#9bf6a3';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 26 - 4 * f);
      ctx.lineTo(c.x + 4, c.y - 18);
      ctx.lineTo(c.x - 4, c.y - 18);
      ctx.fill();
    }
  }

  drawItems(ctx, state, biome) {
    const t = this.time;
    for (const it of state.items) {
      const bob = Math.sin(t * 3 + it.x * 0.1) * 2;
      const y = it.y + bob;
      // brilho
      ctx.globalCompositeOperation = 'lighter';
      const col = it.type === 'potion' ? '255,93,93' : it.type === 'coin' ? '255,209,102' : '199,168,255';
      const g = ctx.createRadialGradient(it.x, y, 0, it.x, y, 16);
      g.addColorStop(0, `rgba(${col},0.22)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(it.x - 16, y - 16, 32, 32);
      ctx.globalCompositeOperation = 'source-over';
      this.drawItemIcon(ctx, it.type, it.x, y, 1);
    }
  }

  drawItemIcon(ctx, type, x, y, scale = 1) {
    const s = (n) => n * scale;
    switch (type) {
      case 'coin':
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.ellipse(x, y, s(4), s(5), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff6c9';
        ctx.fillRect(x - s(1), y - s(3), s(2), s(3));
        break;
      case 'potion':
        ctx.fillStyle = '#e8e8f0';
        ctx.fillRect(x - s(2), y - s(7), s(4), s(3));
        ctx.fillStyle = '#ff5d5d';
        ctx.beginPath();
        ctx.ellipse(x, y, s(4), s(4), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffb0b0';
        ctx.fillRect(x - s(2), y - s(2), s(1), s(2));
        break;
      case 'bomb':
        ctx.fillStyle = '#2b2b33';
        ctx.beginPath();
        ctx.arc(x, y + s(1), s(4), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = s(1);
        ctx.beginPath();
        ctx.moveTo(x + s(1), y - s(3));
        ctx.quadraticCurveTo(x + s(5), y - s(7), x + s(3), y - s(9));
        ctx.stroke();
        break;
      case 'grapple':
        ctx.strokeStyle = '#c7a8ff';
        ctx.lineWidth = s(1.5);
        ctx.beginPath();
        ctx.moveTo(x - s(4), y + s(4));
        ctx.lineTo(x + s(3), y - s(3));
        ctx.stroke();
        ctx.strokeStyle = '#e8dfff';
        ctx.beginPath();
        ctx.arc(x + s(3), y - s(3), s(3), 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'lantern':
        ctx.fillStyle = '#4a4a55';
        ctx.fillRect(x - s(4), y - s(5), s(8), s(9));
        ctx.fillStyle = '#ffe66b';
        ctx.fillRect(x - s(2), y - s(3), s(4), s(5));
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(x - s(1), y - s(6), s(2), s(2));
        break;
      case 'key_big':
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(x - s(5), y - s(2), s(9), s(4));
        ctx.fillRect(x - s(5), y - s(5), s(4), s(10));
        ctx.fillStyle = '#8a6b2a';
        ctx.fillRect(x - s(4), y - s(4), s(2), s(8));
        break;
      default:
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }

  drawPools(ctx, state) {
    const t = this.time;
    for (const pool of state.pools) {
      ctx.globalAlpha = Math.min(1, pool.life * 0.6);
      ctx.fillStyle = '#4c8a3a';
      ctx.beginPath();
      ctx.ellipse(pool.x, pool.y, pool.r, pool.r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b6ff6b';
      ctx.lineWidth = 1;
      ctx.globalAlpha = Math.min(0.9, pool.life * 0.5);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = t * 1.5 + i * 2;
        ctx.fillStyle = '#e4ff6b';
        ctx.globalAlpha = 0.5;
        ctx.fillRect(pool.x + Math.cos(a) * pool.r * 0.5, pool.y + Math.sin(a) * pool.r * 0.35, 1, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawEnemy(ctx, e, biome, state) {
    const type = e.type;
    const t = this.time;
    ctx.save();
    ctx.translate(Math.round(e.x), Math.round(e.y));

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, (e.halfH || 8) - 1, (e.halfW || 10) * 1.05, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const flash = e.hitFlash > 0;
    const windup = e.state === 'windup' || e.state === 'dig' || e.state === 'aim' || e.state === 'inflate' || e.state === 'tongueWindup';

    if (type === 'moss') this.drawMoss(ctx, e, flash, windup, t);
    else if (type === 'eye') this.drawEye(ctx, e, flash, state);
    else if (type === 'beetle') this.drawBeetle(ctx, e, flash);
    else if (type === 'toad') this.drawToad(ctx, e, flash, windup, t);
    else if (type === 'boss') this.drawBoss(ctx, e, flash, windup, t);

    // barra de vida curta
    if (type !== 'boss' && e.hp < e.maxHp) {
      const w = Math.max(16, e.halfW * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-w / 2, -e.halfH - 10, w, 3);
      ctx.fillStyle = '#ff5d5d';
      ctx.fillRect(-w / 2, -e.halfH - 10, (w * e.hp) / e.maxHp, 3);
    }
    ctx.restore();
  }

  drawMoss(ctx, e, flash, windup, t) {
    const body = flash ? '#ffffff' : '#4a3524';
    const moss = flash ? '#ffffff' : '#8fbf4a';
    ctx.fillStyle = '#2b1f14';
    ctx.fillRect(-10, -10, 20, 20);
    ctx.fillStyle = body;
    ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = moss;
    ctx.fillRect(-9, -9, 18, 6);
    ctx.fillRect(-9, 3, 6, 4);
    // braços
    ctx.fillStyle = body;
    ctx.fillRect(-14, -4, 5, 12);
    ctx.fillRect(9, -4, 5, 12);
    // olho
    const eye = windup ? '#fff6c9' : '#ffb03a';
    ctx.fillStyle = windup ? '#ffb03a' : '#2a1a08';
    ctx.fillRect(-5, -2, 10, 5);
    ctx.fillStyle = eye;
    ctx.fillRect(-3, -1, 3, 3);
    ctx.fillRect(1, -1, 3, 3);
    if (windup) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -1, 0, 0, -1, 16);
      g.addColorStop(0, 'rgba(255,176,58,0.5)');
      g.addColorStop(1, 'rgba(255,176,58,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-16, -17, 32, 32);
      ctx.globalCompositeOperation = 'source-over';
    }
    // ponto fraco nas costas
    if (['windup', 'attack', 'recover'].includes(e.state)) {
      const bx = e.facing.x * -8;
      const by = e.facing.y * -8;
      ctx.fillStyle = '#e4ff6b';
      ctx.globalAlpha = 0.7 + Math.sin(t * 12) * 0.3;
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawEye(ctx, e, flash, state) {
    const locked = e.state === 'aim';
    // escudo frontal (fragmentos girando)
    ctx.strokeStyle = flash ? '#ffffff' : '#c7a8ff';
    ctx.lineWidth = 1.5;
    const angle = e.animT * 2;
    for (let i = 0; i < 3; i++) {
      const a = angle + (i * Math.PI * 2) / 3;
      const r = 12;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = '#8a5cff';
      ctx.fillRect(r - 2, -2, 4, 4);
      ctx.restore();
    }
    // corpo
    ctx.fillStyle = flash ? '#ffffff' : '#2a2038';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    // núcleo
    const core = locked ? '#ffb03a' : '#ff8a3d';
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, locked ? 4 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = locked ? '#fff6c9' : '#2a0f00';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    if (locked) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
      g.addColorStop(0, 'rgba(255,138,61,0.5)');
      g.addColorStop(1, 'rgba(255,138,61,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-22, -22, 44, 44);
      ctx.globalCompositeOperation = 'source-over';
    }
    // linha de mira
    const target = state.players.find((p) => p.id === e.lockedId);
    if (locked && target) {
      ctx.strokeStyle = 'rgba(255,138,61,0.45)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(target.x - e.x, target.y - e.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawBeetle(ctx, e, flash) {
    const charging = e.state === 'charge';
    const stunned = e.state === 'stunned';
    const digging = e.state === 'dig';
    // casco
    ctx.fillStyle = flash ? '#ffffff' : '#2b2a33';
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // brilho metálico
    ctx.fillStyle = flash ? '#ffffff' : '#6e7a8a';
    ctx.beginPath();
    ctx.ellipse(-2, -3, 7, 3.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // chifre
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(e.facing.x * 13, e.facing.y * 8);
    ctx.lineTo(e.facing.x * 20 + 3, e.facing.y * 10);
    ctx.lineTo(e.facing.x * 14 + 5, e.facing.y * 10 + 3);
    ctx.fill();
    // pernas
    ctx.strokeStyle = '#1a1a22';
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 6, 6);
      ctx.lineTo(i * 6 + 2, 11);
      ctx.stroke();
    }
    if (digging) {
      ctx.fillStyle = 'rgba(217,160,91,0.7)';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-12 + Math.random() * 24, 8 + Math.random() * 6, 2, 2);
      }
    }
    if (charging) {
      ctx.strokeStyle = 'rgba(255,209,102,0.4)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-e.chargeDirX * i * 9 - 6, -e.chargeDirY * i * 9 - 2);
        ctx.lineTo(-e.chargeDirX * i * 9 + 6, -e.chargeDirY * i * 9 + 2);
        ctx.stroke();
      }
    }
    if (stunned) {
      // ventre exposto
      ctx.fillStyle = '#e4ff6b';
      ctx.globalAlpha = 0.6 + Math.sin(this.time * 14) * 0.3;
      ctx.beginPath();
      ctx.ellipse(0, 4, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // estrelas
      ctx.fillStyle = '#ffd166';
      for (let i = 0; i < 3; i++) {
        const a = this.time * 3 + i * 2;
        ctx.fillRect(Math.cos(a) * 12, -14 + Math.sin(a) * 2, 2, 2);
      }
    }
  }

  drawToad(ctx, e, flash, windup, t) {
    const inflate = e.state === 'inflate' ? 1 + (1 - Math.max(0, e.stateT) / 0.6) * 0.35 : 1;
    // corpo
    ctx.fillStyle = flash ? '#ffffff' : '#7a5c8c';
    ctx.beginPath();
    ctx.ellipse(0, 1, 10 * inflate, 9 * inflate, 0, 0, Math.PI * 2);
    ctx.fill();
    // papo
    ctx.fillStyle = flash ? '#ffffff' : (windup ? '#b6ff6b' : '#8f6ea3');
    ctx.beginPath();
    ctx.ellipse(0, 5, 7 * inflate, 5 * inflate, 0, 0, Math.PI * 2);
    ctx.fill();
    // verrugas
    ctx.fillStyle = '#b6ff6b';
    for (let i = 0; i < 4; i++) {
      const a = i * 1.9 + 0.6;
      ctx.fillRect(Math.cos(a) * 7, Math.sin(a) * 5 - 2, 2, 2);
    }
    // olhos
    ctx.fillStyle = '#ffe66b';
    ctx.beginPath();
    ctx.arc(-5, -6, 3, 0, Math.PI * 2);
    ctx.arc(5, -6, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0f00';
    ctx.fillRect(-6, -7, 2, 2);
    ctx.fillRect(4, -7, 2, 2);
    if (windup) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 4, 0, 0, 4, 18);
      g.addColorStop(0, 'rgba(182,255,107,0.4)');
      g.addColorStop(1, 'rgba(182,255,107,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-18, -14, 36, 36);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (e.tongue) {
      const target = { x: 0, y: 0 };
      const dx = (e.tongue.x || 0) - e.x;
      // a língua em si é desenhada a partir do alvo no HUD do mundo
      ctx.strokeStyle = '#ff8ab0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(Math.sign(dx) * 20 || 20, 0);
      ctx.stroke();
    }
  }

  drawBoss(ctx, e, flash, windup, t) {
    const s = 1.9;
    const phase2 = e.phase === 2;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // corpo
    ctx.fillStyle = flash ? '#ffffff' : (phase2 ? '#6a3d7a' : '#7a5c8c');
    ctx.beginPath();
    ctx.ellipse(0, 0, 20 * s * 0.55, 17 * s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // papo
    ctx.fillStyle = phase2 ? '#9b6ab0' : '#8f6ea3';
    ctx.beginPath();
    ctx.ellipse(0, 8, 13, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    // verrugas brilhantes
    ctx.fillStyle = phase2 ? '#ff8ab0' : '#b6ff6b';
    for (let i = 0; i < 7; i++) {
      const a = i * 1.1 + 0.3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 14, Math.sin(a) * 10 - 3, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // olhos grandes
    ctx.fillStyle = '#ffe66b';
    ctx.beginPath();
    ctx.arc(-9, -10, 5, 0, Math.PI * 2);
    ctx.arc(9, -10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0f00';
    ctx.fillRect(-10, -12, 3, 4);
    ctx.fillRect(8, -12, 3, 4);
    // coroa
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(-12, -16);
    ctx.lineTo(-8, -22);
    ctx.lineTo(-4, -17);
    ctx.lineTo(0, -24);
    ctx.lineTo(4, -17);
    ctx.lineTo(8, -22);
    ctx.lineTo(12, -16);
    ctx.fill();
    if (phase2) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 50);
      g.addColorStop(0, 'rgba(199,125,255,0.25)');
      g.addColorStop(1, 'rgba(199,125,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-50, -50, 100, 100);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (e.state === 'windup') {
      ctx.strokeStyle = 'rgba(255,138,176,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + Math.sin(t * 20) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawPlayer(ctx, p, state, isLocal) {
    const kit = KITS[p.kit];
    if (!kit) return;
    const blink = p.invT > 0 && p.invT < 90 && Math.floor(this.time * 16) % 2 === 0;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, p.halfH - 1, p.halfW + 2, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (p.downed || p.dead) {
      this.drawDowned(ctx, p, kit, state);
      ctx.restore();
      return;
    }

    ctx.globalAlpha = blink ? 0.45 : 1;
    const flip = p.facing.x < -0.01 ? -1 : 1;
    const speed = Math.hypot(p.vx || 0, p.vy || 0);
    const walk = Math.sin((p.animT || 0) * 14) * (speed > 10 ? 1 : 0.15);

    if (p.kit === 'vanguard') this.drawVanguard(ctx, p, kit, walk, flip);
    else this.drawScout(ctx, p, kit, walk, flip);

    // escudo/guarda
    if (p.blocking) {
      const fx = p.facing.x;
      const fy = p.facing.y;
      ctx.save();
      ctx.translate(fx * 10, fy * 6);
      ctx.fillStyle = '#bff3ff';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // ataque (arco)
    if (p.atkT > 0.06 && p.kit === 'vanguard') {
      const prog = 1 - p.atkT / 0.28;
      const ang = Math.atan2(p.facing.y, p.facing.x);
      ctx.save();
      ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(191,243,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 20 + prog * 6, -0.8, 0.8);
      ctx.stroke();
      ctx.restore();
    }

    // marca da batedora
    if (p.markT > 0) {
      ctx.fillStyle = '#ff8a4c';
      ctx.globalAlpha = 0.8;
      ctx.fillRect(-3, -p.halfH - 10, 6, 2);
      ctx.globalAlpha = 1;
    }

    // nome
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = kit.color;
    ctx.font = '6px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.name || '', 0, -p.halfH - (isLocal ? 14 : 13));
    if (isLocal) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '5px "Courier New", monospace';
      ctx.fillText('▲', 0, -p.halfH - 20);
    }

    // reanimando
    if (p.reviving) {
      ctx.fillStyle = '#9bf6a3';
      ctx.font = '7px "Courier New", monospace';
      ctx.fillText('+', 0, -p.halfH - 22);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawVanguard(ctx, p, kit, walk, flip) {
    const c = kit.color;
    const d = kit.dark;
    ctx.save();
    ctx.scale(flip, 1);
    // pernas
    ctx.fillStyle = '#17323d';
    ctx.fillRect(-6, 10, 4, 7 + walk * 2);
    ctx.fillRect(2, 10, 4, 7 - walk * 2);
    // capa
    ctx.fillStyle = d;
    ctx.beginPath();
    ctx.moveTo(-8, -4);
    ctx.lineTo(-11, 10);
    ctx.lineTo(0, 8);
    ctx.lineTo(11, 10);
    ctx.lineTo(8, -4);
    ctx.fill();
    // torso
    ctx.fillStyle = c;
    ctx.fillRect(-8, -8, 16, 16);
    ctx.fillStyle = d;
    ctx.fillRect(-8, 2, 16, 4);
    // ombreiras
    ctx.fillStyle = '#d8f4ff';
    ctx.fillRect(-11, -8, 5, 6);
    ctx.fillRect(6, -8, 5, 6);
    // elmo
    ctx.fillStyle = '#d8f4ff';
    ctx.fillRect(-6, -18, 12, 10);
    ctx.fillStyle = '#17323d';
    ctx.fillRect(-4, -14, 8, 3);
    // crista
    ctx.fillStyle = c;
    ctx.fillRect(-1, -21, 2, 4);
    // escudo no braço
    ctx.fillStyle = '#bff3ff';
    ctx.fillRect(9, -6, 5, 14);
    ctx.fillStyle = c;
    ctx.fillRect(10, -4, 3, 10);
    ctx.restore();
  }

  drawScout(ctx, p, kit, walk, flip) {
    const c = kit.color;
    const d = kit.dark;
    ctx.save();
    ctx.scale(flip, 1);
    // pernas
    ctx.fillStyle = '#3a2015';
    ctx.fillRect(-4, 9, 3, 8 + walk * 2);
    ctx.fillRect(1, 9, 3, 8 - walk * 2);
    // capa curta
    ctx.fillStyle = d;
    ctx.beginPath();
    ctx.moveTo(-5, -6);
    ctx.lineTo(-9, 7);
    ctx.lineTo(0, 5);
    ctx.lineTo(9, 7);
    ctx.lineTo(5, -6);
    ctx.fill();
    // corpo
    ctx.fillStyle = c;
    ctx.fillRect(-5, -7, 10, 15);
    ctx.fillStyle = '#ffd0b0';
    ctx.fillRect(-3, 6, 6, 4);
    // capuz
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-6, -8);
    ctx.lineTo(0, -20);
    ctx.lineTo(6, -8);
    ctx.fill();
    ctx.fillStyle = '#2a1408';
    ctx.fillRect(-4, -12, 8, 4);
    // olhos brilhantes
    ctx.fillStyle = '#fff6c9';
    ctx.fillRect(-3, -11, 2, 2);
    ctx.fillRect(1, -11, 2, 2);
    // adaga
    ctx.fillStyle = '#e8e8f0';
    ctx.fillRect(6, -2, 8, 2);
    ctx.fillRect(12, -1, 3, 1);
    ctx.restore();
  }

  drawDowned(ctx, p, kit, state) {
    const t = this.time;
    ctx.fillStyle = kit.dark;
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.color;
    ctx.fillRect(-6, -2, 12, 3);
    // anel pulsante
    ctx.strokeStyle = kit.color;
    ctx.globalAlpha = 0.4 + Math.sin(t * 5) * 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 12 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // barra de reanimação
    if (p.reviveT > 0) {
      const w = 26;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(-w / 2, -18, w, 4);
      ctx.fillStyle = '#9bf6a3';
      ctx.fillRect(-w / 2, -18, (w * p.reviveT) / 3, 4);
    }
    // contagem
    ctx.fillStyle = '#ff9b9b';
    ctx.font = '6px "Courier New", monospace';
    ctx.textAlign = 'center';
    const left = Math.max(0, 20 - (p.downedT || 0));
    ctx.fillText(`${Math.ceil(left)}s`, 0, -22);
  }

  drawProjectiles(ctx, state) {
    const t = this.time;
    for (const pr of state.projectiles) {
      const x = pr.x;
      const y = pr.y;
      if (pr.type === 'dagger') {
        ctx.strokeStyle = '#ff8a4c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - (pr.dirX || 1) * 5, y - (pr.dirY || 0) * 5);
        ctx.lineTo(x + (pr.dirX || 1) * 5, y + (pr.dirY || 0) * 5);
        ctx.stroke();
        ctx.fillStyle = '#fff6c9';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      } else if (pr.type === 'crystal') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 6);
        ctx.fillStyle = '#c7a8ff';
        ctx.fillRect(-3, -3, 6, 6);
        ctx.fillStyle = '#e8dfff';
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
        g.addColorStop(0, 'rgba(138,92,255,0.35)');
        g.addColorStop(1, 'rgba(138,92,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 10, y - 10, 20, 20);
        ctx.globalCompositeOperation = 'source-over';
      } else if (pr.type === 'acid') {
        ctx.fillStyle = '#9bf6a3';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e4ff6b';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      } else if (pr.type === 'bomb') {
        const blink = Math.floor(t * 10) % 2 === 0;
        ctx.fillStyle = '#1a1a22';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = blink ? '#ff5d5d' : '#ffd166';
        ctx.fillRect(x - 1, y - 7, 2, 2);
        ctx.strokeStyle = 'rgba(255,209,102,0.4)';
        ctx.beginPath();
        ctx.arc(x, y, 9 + Math.sin(t * 8) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      if (p.ring) {
        const r = p.r0 + (p.r1 - p.r0) * (1 - a);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.line || 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        if (p.glow) {
          ctx.globalCompositeOperation = 'lighter';
        }
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  drawPings(ctx) {
    for (const p of this.pings) {
      const age = p.t;
      const pulse = 1 + Math.sin(age * 10) * 0.2;
      const alpha = Math.min(1, (p.life - age) * 2);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.kind === 'help' ? '#ff8a4c' : '#4fc3f7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16 * pulse, 0, Math.PI * 2);
      ctx.globalAlpha = alpha * 0.4;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.kind === 'help' ? '#ff8a4c' : '#4fc3f7';
      ctx.font = '7px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.kind === 'help' ? '!' : p.kind === 'go' ? '»' : p.kind === 'item' ? '◆' : '?', p.x, p.y - 20);
      ctx.globalAlpha = 1;
    }
  }

  drawFog(ctx, state, biome) {
    const room = state.room;
    if (!room) return;
    const foggy = room.fog || room.biome === 'cave';
    if (!foggy) return;
    const strength = room.biome === 'cave' ? 0.35 : 0.62;
    const f = this.fogCtx;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, VIEW_W, VIEW_H);
    f.fillStyle = room.biome === 'cave' ? 'rgba(4,2,10,0.95)' : 'rgba(12,22,16,0.95)';
    f.fillRect(0, 0, VIEW_W, VIEW_H);

    // buracos de luz ao redor dos jogadores
    const cam = state.camera;
    f.globalCompositeOperation = 'destination-out';
    for (const p of state.players) {
      const sx = (p.x - cam.x) * cam.zoom + VIEW_W / 2;
      const sy = (p.y - cam.y) * cam.zoom + VIEW_H / 2;
      const hasLight = p.lanternOn || room.biome === 'cave';
      const r = (hasLight ? 74 : 30) * cam.zoom;
      const g = f.createRadialGradient(sx, sy, r * 0.25, sx, sy, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    f.globalCompositeOperation = 'source-over';

    ctx.globalAlpha = strength;
    ctx.drawImage(this.fogCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  drawVignette(ctx, biome, state) {
    const p = biome.palette;
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (this.damageFlash > 0) {
      ctx.fillStyle = `rgba(255,40,40,${this.damageFlash * 0.28})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  // ------------------------------------------------------------------- HUD
  drawHUD(ctx, state, biome) {
    const local = state.players.find((p) => p.id === state.myId);
    const other = state.players.find((p) => p.id !== state.myId);

    // nome da sala / bioma
    ctx.textAlign = 'center';
    ctx.font = '7px "Courier New", monospace';
    ctx.fillStyle = biome.palette.leafLight;
    ctx.fillText(`${biome.name.toUpperCase()} · ${state.room.name}`, VIEW_W / 2, 10);
    ctx.fillStyle = 'rgba(216,232,238,0.55)';
    ctx.font = '5px "Courier New", monospace';
    ctx.fillText(state.room.boss ? 'CHEFE' : `SALA ${state.roomIndex + 1}/8 · ${biome.teaching}`, VIEW_W / 2, 18);

    // painéis dos jogadores
    this.drawPlayerPanel(ctx, local, 'left', true);
    this.drawPlayerPanel(ctx, other, 'right', false);

    // chaves compartilhadas
    if (state.world.keys > 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166';
      ctx.font = '7px "Courier New", monospace';
      ctx.fillText(`⚿ ${state.world.keys}`, VIEW_W / 2, 26);
    }

    // latência
    const lat = state.latency || 0;
    const color = lat < 80 ? '#9bf6a3' : lat < 160 ? '#ffd166' : '#ff5d5d';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(VIEW_W - 8, 8, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(216,232,238,0.5)';
    ctx.font = '5px "Courier New", monospace';
    ctx.fillText(`${Math.round(lat)}ms`, VIEW_W - 12, 10);

    // barra do chefe
    if (state.room.boss && state.world.bossMax > 0) {
      const w = 150;
      const x = (VIEW_W - w) / 2;
      const y = 30;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 1, y - 1, w + 2, 8);
      ctx.fillStyle = '#3a1520';
      ctx.fillRect(x, y, w, 6);
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(x, y, (w * state.world.bossHp) / state.world.bossMax, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.strokeRect(x, y, w, 6);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8dfff';
      ctx.font = '6px "Courier New", monospace';
      ctx.fillText('CORAÇÃO DO PÂNTANO', VIEW_W / 2, y + 15);
    }

    // dica de interação próxima
    if (local) this.drawInteractHint(ctx, state, local);

    // aviso de caído
    if (local && (local.downed || local.dead)) {
      ctx.fillStyle = 'rgba(120,0,0,0.25)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb0b0';
      ctx.font = '8px "Courier New", monospace';
      ctx.fillText('CAÍDO — aguarde o parceiro (E)', VIEW_W / 2, VIEW_H - 52);
    } else if (other && other.downed && !other.dead) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff9b9b';
      ctx.font = '7px "Courier New", monospace';
      ctx.fillText('PARCEIRO CAÍDO — segure E perto dele', VIEW_W / 2, VIEW_H - 52);
    }

    // objetivo
    if (!state.room.boss) {
      const hint = this.objectiveHint(state);
      if (hint) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(216,232,238,0.35)';
        ctx.font = '5px "Courier New", monospace';
        ctx.fillText(hint, VIEW_W / 2, VIEW_H - 8);
      }
    }
  }

  objectiveHint(state) {
    const inv = state.players.map((p) => p.inv);
    const has = (t) => inv.some((i) => i && (i.tool?.type === t || i.slots.some((s) => s && s.type === t)));
    if (!has('bomb') && state.roomIndex <= 2) return 'Encontre a Bomba no Bosque para quebrar a parede rachada';
    if (!has('grapple') && state.roomIndex <= 4) return 'O Gancho permite cruzar o abismo das dunas';
    if (!has('lantern') && state.roomIndex <= 5) return 'A Lanterna revela a névoa do pântano';
    if (state.roomIndex === 6 && state.world.keys <= 0) return 'Pegue a Chave Grande para abrir o portão do Coração';
    return '';
  }

  drawPlayerPanel(ctx, p, side, isLocal) {
    if (!p) return;
    const kit = KITS[p.kit] || KITS.vanguard;
    const w = 96;
    const x = side === 'left' ? 6 : VIEW_W - w - 6;
    const y = VIEW_H - 34;

    ctx.fillStyle = 'rgba(6,12,15,0.72)';
    ctx.fillRect(x, y, w, 28);
    ctx.strokeStyle = isLocal ? kit.color : '#2c4a56';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 27);

    // corações
    const hearts = Math.ceil(p.maxHp / 4);
    for (let i = 0; i < hearts; i++) {
      const hpInHeart = Math.max(0, Math.min(4, p.hp - i * 4));
      this.drawHeart(ctx, x + 4 + i * 8, y + 4, hpInHeart);
    }

    // nome
    ctx.textAlign = 'left';
    ctx.font = '5px "Courier New", monospace';
    ctx.fillStyle = kit.color;
    ctx.fillText(`${p.name}${isLocal ? ' (você)' : ''}`, x + 4, y + 18);

    // moedas
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(x + 4, y + 21, 3, 3);
    ctx.fillStyle = '#ffd166';
    ctx.font = '5px "Courier New", monospace';
    ctx.fillText(`${p.coins}`, x + 9, y + 24);

    // slots rápidos
    for (let i = 0; i < 2; i++) {
      const sx = x + w - 30 + i * 13;
      const sy = y + 14;
      ctx.fillStyle = '#0a1216';
      ctx.fillRect(sx, sy, 11, 11);
      ctx.strokeStyle = '#223741';
      ctx.strokeRect(sx + 0.5, sy + 0.5, 10, 10);
      const item = p.inv.quick[i];
      if (item) this.drawItemIcon(ctx, item.type, sx + 5.5, sy + 5.5, 0.6);
      ctx.fillStyle = 'rgba(216,232,238,0.45)';
      ctx.font = '4px "Courier New", monospace';
      ctx.fillText(`${i + 1}`, sx + 1, sy + 4);
    }

    // ferramenta equipada
    if (p.inv.tool) {
      this.drawItemIcon(ctx, p.inv.tool.type, x + w - 44, y + 20, 0.7);
    }
  }

  drawHeart(ctx, x, y, hp) {
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        if (!HEART_PX[row][col]) continue;
        const filled = (row * 5 + col) < Math.ceil((hp / 4) * 25);
        ctx.fillStyle = filled ? '#ff5d5d' : 'rgba(90,30,35,0.8)';
        ctx.fillRect(x + col, y + row, 1, 1);
      }
    }
    if (hp > 0 && hp < 4) {
      ctx.fillStyle = '#ffb0b0';
      ctx.fillRect(x + 1, y + 2, 1, 1);
    }
  }

  drawInteractHint(ctx, state, local) {
    let target = null;
    let label = '';
    let best = 30;

    for (const it of state.items) {
      if (ITEM_DEFS[it.type]?.auto) continue;
      const d = Math.hypot(it.x - local.x, it.y - local.y);
      if (d < best) {
        best = d;
        target = it;
        label = 'E pegar';
      }
    }
    const other = state.players.find((p) => p.id !== local.id);
    if (other && other.downed && !other.dead) {
      const d = Math.hypot(other.x - local.x, other.y - local.y);
      if (d < best) {
        best = d;
        target = other;
        label = 'segure E reanimar';
      }
    }
    if (state.room.checkpoint) {
      const d = Math.hypot(state.room.checkpoint.x - local.x, state.room.checkpoint.y - local.y);
      if (d < best) {
        best = d;
        target = state.room.checkpoint;
        label = 'E descansar';
      }
    }
    if (!target) return;
    ctx.textAlign = 'center';
    ctx.font = '6px "Courier New", monospace';
    const tx = target.x;
    const ty = target.y - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    const tw = ctx.measureText(label).width + 8;
    ctx.fillRect(tx - tw / 2, ty - 7, tw, 10);
    ctx.fillStyle = '#e8fff0';
    ctx.fillText(label, tx, ty);
  }
}
