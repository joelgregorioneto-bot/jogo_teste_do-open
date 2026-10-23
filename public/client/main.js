// Cliente: conexão, predição do próprio jogador, reconciliação com o servidor,
// câmera compartilhada e orquestração da interface.

import { DT, VIEW_W, VIEW_H, KITS, NET } from '/shared/constants.js';
import { stepPlayer, clamp } from '/shared/sim.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new Input();
const audio = new AudioEngine();
const ui = new UI({
  onJoin: (opts) => connect(opts),
  onInvAction: (action) => send({ t: 'inv', ...action }),
});

const S = {
  ws: null,
  phase: 'lobby', // lobby | playing | dead
  myId: null,
  token: localStorage.getItem('aventura_token') || null,
  code: null,
  name: null,
  kit: null,
  started: false,
  room: null,
  roomIndex: -1,
  snap: null,
  local: null,
  remote: null,
  enemies: new Map(),
  projectiles: [],
  items: [],
  pools: [],
  world: { keys: 0, checkpoint: { room: 0, x: 0, y: 0 }, bossHp: 0, bossMax: 0, bossDead: false },
  camera: { x: 160, y: 90, zoom: 1 },
  latency: 0,
  lastPing: 0,
  history: [],
  seq: 0,
  acc: 0,
  last: performance.now(),
  invThrottle: 0,
  victoryShown: false,
  reconnectT: 0,
  partnerOnline: false,
};

// ------------------------------------------------------------------ conexão
function connect({ name, code, kit }) {
  S.name = name;
  S.code = code;
  S.kit = kit;
  ui.setLobbyMessage('Conectando…');

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  S.ws = ws;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      t: 'join',
      name,
      code,
      kit,
      token: S.token,
    }));
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  });

  ws.addEventListener('close', () => {
    if (S.started) {
      ui.setDisconnected(true);
      ui.toast('Conexão perdida — reconectando…', 'warn');
      S.reconnectT = performance.now();
    } else {
      ui.setLobbyMessage('Não foi possível conectar. O servidor está rodando?');
    }
  });

  ws.addEventListener('error', () => {
    ui.setLobbyMessage('Erro de conexão. Verifique o servidor.');
  });
}

function send(obj) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj));
}

function handle(msg) {
  switch (msg.t) {
    case 'welcome': {
      S.myId = msg.id;
      S.token = msg.token;
      localStorage.setItem('aventura_token', msg.token);
      S.started = true;
      S.phase = 'playing';
      S.room = msg.room;
      S.roomIndex = msg.room.index;
      renderer.setRoom(msg.room);
      S.history = [];
      S.victoryShown = false;
      ui.hideLobby();
      ui.setDisconnected(false);
      S.local = null;
      applySnapshot(msg.snap, true);
      audio.ensure();
      ui.toast(msg.resumed ? 'Reconectado!' : `Bem-vindo, ${S.name}`, 'good');
      break;
    }
    case 'room': {
      S.room = msg.room;
      S.roomIndex = msg.room.index;
      renderer.setRoom(msg.room);
      S.history = [];
      S.enemies.clear();
      S.remote = null;
      // Reposiciona a predição local para o início da sala até chegar o snapshot.
      if (S.local) {
        S.local.x = msg.room.w / 2;
        S.local.y = msg.room.h / 2;
      }
      break;
    }
    case 'snap': {
      applySnapshot(msg, false);
      break;
    }
    case 'full':
      ui.setLobbyMessage('Sala cheia (2/2). Peça o código ou tente outra sala.');
      S.ws?.close();
      break;
    case 'partner_join':
      S.partnerOnline = true;
      ui.toast(`${msg.name} entrou na aventura`, 'good');
      audio.play('trade');
      break;
    case 'partner_lost':
      S.partnerOnline = false;
      ui.toast(`${msg.name} desconectou — 120s de carência`, 'warn');
      break;
    case 'partner_back':
      S.partnerOnline = true;
      ui.toast(`${msg.name} voltou`, 'good');
      break;
    case 'pong':
      S.latency = performance.now() - msg.ts;
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ snapshots
function applySnapshot(snap, initial) {
  const prevRoom = S.roomIndex;
  S.snap = snap;
  S.world = snap.world;
  S.roomIndex = snap.roomIndex;

  if (snap.roomIndex !== prevRoom && S.room) {
    // O layout chega pela mensagem 'room'; se não chegou, mantém o atual.
  }

  const me = snap.players.find((p) => p.id === S.myId);
  if (me) {
    if (initial || !S.local) {
      S.local = structuredClone(me);
    } else {
      // Reconciliação: parte do estado autoritativo e reaplica os inputs não confirmados.
      const sim = structuredClone(me);
      const solids = S.room ? S.room.solids : [];
      const pending = S.history.filter((h) => h.seq > (me.ack || 0));
      for (const h of pending) stepPlayer(sim, h.input, solids, DT);
      sim.x = clamp(sim.x, sim.halfW, (S.room?.w || 640) - sim.halfW);
      sim.y = clamp(sim.y, sim.halfH, (S.room?.h || 352) - sim.halfH);
      S.local = sim;
      S.history = pending;
    }
  }

  const other = snap.players.find((p) => p.id !== S.myId);
  if (other) {
    S.partnerOnline = true;
    if (!S.remote || S.remote.id !== other.id) {
      S.remote = structuredClone(other);
      S.remote.tx = other.x;
      S.remote.ty = other.y;
    } else {
      const { x, y } = S.remote;
      Object.assign(S.remote, other);
      S.remote.x = x;
      S.remote.y = y;
      S.remote.tx = other.x;
      S.remote.ty = other.y;
    }
  } else {
    S.remote = null;
  }

  // Inimigos com alvo interpolado
  const alive = new Set();
  for (const e of snap.enemies) {
    alive.add(e.id);
    let r = S.enemies.get(e.id);
    if (!r) {
      r = { ...e, x: e.x, y: e.y, tx: e.x, ty: e.y };
      S.enemies.set(e.id, r);
    } else {
      const { x, y } = r;
      Object.assign(r, e);
      r.x = x;
      r.y = y;
      r.tx = e.x;
      r.ty = e.y;
    }
  }
  for (const id of [...S.enemies.keys()]) if (!alive.has(id)) S.enemies.delete(id);

  S.projectiles = snap.projectiles;
  S.items = snap.items;
  S.pools = snap.pools;

  for (const ev of snap.events || []) handleEvent(ev);

  if (ui.invOpen) {
    const now = performance.now();
    if (now - S.invThrottle > 200) {
      S.invThrottle = now;
      ui.setSnapshot(snap, S.myId);
    }
  } else {
    ui.lastSnap = snap;
    ui.myId = S.myId;
  }
}

function handleEvent(ev) {
  renderer.event(ev);
  switch (ev.type) {
    case 'hit': audio.play(ev.weak ? 'weak' : 'hit'); break;
    case 'hurt': audio.play('hurt'); break;
    case 'downed': audio.play('downed'); ui.toast(`${nameOf(ev.player)} caiu!`, 'warn'); break;
    case 'death': audio.play('death'); ui.toast(`${nameOf(ev.player)} morreu — voltará no checkpoint`, 'warn'); break;
    case 'revive': audio.play('revive'); ui.toast(`${nameOf(ev.player)} foi reanimado!`, 'good'); break;
    case 'kill': audio.play('kill'); break;
    case 'coin': audio.play('coin'); break;
    case 'pickup': audio.play('pickup'); break;
    case 'checkpoint': audio.play('checkpoint'); ui.toast('Checkpoint ativado — vida restaurada', 'good'); break;
    case 'checkpoint':
      break;
    case 'shoot': audio.play('shoot'); break;
    case 'explosion': audio.play('explosion'); break;
    case 'weak': audio.play('weak'); break;
    case 'deny': ui.toast(ev.why || 'Não é possível', 'warn'); break;
    case 'locked': ui.toast(ev.text || 'Portão trancado', 'warn'); audio.play('deny'); break;
    case 'transition': audio.play('door'); ui.toast(`→ ${ev.name}`, ''); S.history = []; break;
    case 'room': break;
    case 'trade_offer': ui.addTradeOffer(ev); ui.toast(`${ev.fromName} quer trocar um item`, 'good'); break;
    case 'trade_done': ui.removeTradeOffer(ev.id); ui.toast('Troca concluída', 'good'); audio.play('trade'); break;
    case 'trade_declined': ui.removeTradeOffer(ev.id); break;
    case 'boss_phase': ui.toast('O Coração se enfureceu!', 'warn'); audio.play('boss'); break;
    case 'tongue': audio.play('deny'); ui.toast('Agarrado pela língua — parceiro, corte!', 'warn'); break;
    case 'tongue_break': ui.toast('Língua cortada!', 'good'); break;
    case 'wipe': ui.toast('A dupla caiu — retornando ao checkpoint', 'warn'); break;
    case 'victory': audio.play('victory'); if (!S.victoryShown) { S.victoryShown = true; setTimeout(() => ui.showVictory(), 900); } break;
    case 'key': ui.toast('Chave Grande obtida (compartilhada)', 'good'); break;
    case 'key_used': ui.toast('Portão do Coração aberto', 'good'); break;
    case 'explosion':
      break;
    case 'ping_action': renderer.ping(ev.x, ev.y, ev.kind, ev.player); audio.play('ping'); break;
    case 'respawn': audio.play('revive'); break;
    case 'fall': audio.play('hurt'); break;
    case 'grapple': audio.play('grapple'); break;
    case 'bomb_place': break;
    case 'lantern': audio.play('pickup'); break;
    default: break;
  }
}

function nameOf(id) {
  const p = S.snap?.players.find((x) => x.id === id);
  return p ? p.name : 'Jogador';
}

// --------------------------------------------------------------------- loop
let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (S.started && S.local && S.room) {
    S.acc += dt;
    let steps = 0;
    while (S.acc >= DT && steps < 5) {
      fixedUpdate();
      S.acc -= DT;
      steps++;
    }
    updateRenderEntities(dt);
    updateCamera(dt);
    render(dt);
    handleTaps();
    if (now - S.lastPing > 2000) {
      S.lastPing = now;
      send({ t: 'ping', ts: now });
    }
  }

  renderer.update(dt);
  requestAnimationFrame(frame);
}

function fixedUpdate() {
  const inp = input.sample();
  if (ui.invOpen || ui.helpOpen) {
    inp.mx = 0;
    inp.my = 0;
    inp.dash = false;
    inp.attack = false;
    inp.block = false;
    inp.interact = false;
    inp.use1 = false;
    inp.use2 = false;
  }

  S.seq += 1;
  send({ t: 'input', seq: S.seq, ...inp });
  S.history.push({ seq: S.seq, input: inp });
  if (S.history.length > 240) S.history.shift();

  stepPlayer(S.local, inp, S.room.solids, DT);
  S.local.x = clamp(S.local.x, S.local.halfW, S.room.w - S.local.halfW);
  S.local.y = clamp(S.local.y, S.local.halfH, S.room.h - S.local.halfH);
}

function updateRenderEntities(dt) {
  // parceiro
  if (S.remote) {
    const lead = 0.06;
    const tx = S.remote.tx + (S.remote.vx || 0) * lead;
    const ty = S.remote.ty + (S.remote.vy || 0) * lead;
    const k = 1 - Math.exp(-dt * 14);
    S.remote.x += (tx - S.remote.x) * k;
    S.remote.y += (ty - S.remote.y) * k;
  }
  // inimigos
  const k = 1 - Math.exp(-dt * 18);
  for (const e of S.enemies.values()) {
    e.x += (e.tx - e.x) * k;
    e.y += (e.ty - e.y) * k;
  }
}

function updateCamera(dt) {
  const me = S.local;
  const other = S.remote;
  let midX = me.x;
  let midY = me.y;
  let d = 0;
  if (other) {
    midX = (me.x + other.x) / 2;
    midY = (me.y + other.y) / 2;
    d = Math.hypot(other.x - me.x, other.y - me.y);
  }
  // look-ahead na direção do movimento local
  midX += clamp((me.vx || 0) * 0.14, -22, 22);
  midY += clamp((me.vy || 0) * 0.14, -22, 22);

  let targetZoom = 1;
  if (d > NET.MAX_SEPARATION) targetZoom = NET.CAM_ZOOM_MIN;
  else if (d > NET.MIN_SEPARATION) {
    const t = (d - NET.MIN_SEPARATION) / (NET.MAX_SEPARATION - NET.MIN_SEPARATION);
    targetZoom = 1 - t * (1 - NET.CAM_ZOOM_MIN);
  }
  const k = 1 - Math.exp(-dt * 6);
  S.camera.zoom += (targetZoom - S.camera.zoom) * k;

  const halfW = VIEW_W / (2 * S.camera.zoom);
  const halfH = VIEW_H / (2 * S.camera.zoom);
  const room = S.room;
  const cx = room.w <= halfW * 2 ? room.w / 2 : clamp(midX, halfW, room.w - halfW);
  const cy = room.h <= halfH * 2 ? room.h / 2 : clamp(midY, halfH, room.h - halfH);

  const ck = 1 - Math.exp(-dt * 10);
  S.camera.x += (cx - S.camera.x) * ck;
  S.camera.y += (cy - S.camera.y) * ck;
}

function render(dt) {
  const players = [];
  if (S.remote) players.push(S.remote);
  if (S.local) players.push(S.local);
  const state = {
    room: S.room,
    roomIndex: S.roomIndex,
    players,
    enemies: [...S.enemies.values()],
    projectiles: S.projectiles,
    items: S.items,
    pools: S.pools,
    world: S.world,
    camera: S.camera,
    myId: S.myId,
    latency: S.latency,
  };
  renderer.draw(state);
}

function handleTaps() {
  const taps = input.takeTaps();
  for (const code of taps) {
    if (code === 'KeyI') {
      ui.toggleInventory();
      audio.ensure();
    } else if (code === 'KeyH') {
      ui.toggleHelp();
    } else if (code === 'KeyQ') {
      const partner = S.remote;
      const kind = partner && partner.downed ? 'help' : 'here';
      send({ t: 'ping_action', kind });
      audio.ensure();
    }
  }
}

// --------------------------------------------------------------- redimensiona
function resize() {
  const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const s = scale >= 1 ? Math.floor(scale) : scale;
  canvas.style.width = `${Math.round(VIEW_W * s)}px`;
  canvas.style.height = `${Math.round(VIEW_H * s)}px`;
}
window.addEventListener('resize', resize);
resize();

// Desbloqueia áudio no primeiro clique
window.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// Reconexão automática
setInterval(() => {
  if (S.started && S.ws && S.ws.readyState > 1 && S.token && S.code) {
    if (performance.now() - S.reconnectT > 2000) {
      S.reconnectT = performance.now();
      connect({ name: S.name, code: S.code, kit: S.kit });
    }
  }
}, 1000);

requestAnimationFrame(frame);

// Exposto para depuração no console
window.__aventura = { S, renderer, ui };
