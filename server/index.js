// Servidor: HTTP (arquivos do jogo) + WebSocket autoritativo.
// Cada sessão tem no máximo 2 jogadores e uma simulação a 60Hz.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { SNAPSHOT_RATE, TICK_RATE, KITS } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT || 8080);
const LAG = Number(process.env.NET_LAG || 0); // latência artificial para testes

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  let base = PUBLIC;
  if (url.startsWith('/shared/')) {
    // O prefixo /shared faz parte da URL, não do sistema de arquivos.
    base = SHARED;
    url = url.slice('/shared'.length);
  }
  const file = path.resolve(base, '.' + url);
  if (!file.startsWith(base)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

// ------------------------------------------------------------------ sessões
const sessions = new Map();

function getSession(code) {
  let s = sessions.get(code);
  if (!s) {
    s = {
      code,
      game: new Game(code),
      clients: new Set(),
      loop: null,
      acc: 0,
      last: Date.now(),
      emptySince: null,
      seq: 0,
      disconnected: new Map(), // token -> { playerId, timer }
    };
    s.loop = setInterval(() => stepSession(s), 4);
    sessions.set(code, s);
  }
  return s;
}

function stepSession(s) {
  const now = Date.now();
  let dt = (now - s.last) / 1000;
  s.last = now;
  if (dt > 0.25) dt = 0.25;
  s.acc += dt;
  const step = 1 / TICK_RATE;
  let n = 0;
  while (s.acc >= step && n < 8) {
    s.game.tick();
    s.acc -= step;
    n++;
    s.seq++;
    if (s.seq % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) broadcast(s);
  }
  if (s.clients.size === 0) {
    if (!s.emptySince) s.emptySince = now;
    if (now - s.emptySince > 45_000) {
      s.game.save();
      clearInterval(s.loop);
      sessions.delete(s.code);
      console.log(`[sessão ${s.code}] encerrada e salva.`);
    }
  } else {
    s.emptySince = null;
  }
}

function broadcast(s) {
  if (s.clients.size === 0) return;
  const base = s.game.buildSnapshot();
  base.events = s.game.consumeEvents();
  const payload = JSON.stringify(base);
  for (const ws of s.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    const p = s.game.players.get(ws.playerId);
    // Envia layout da sala quando muda (o cliente precisa disso para predição).
    if (p && ws.roomSent !== s.game.roomIndex) {
      send(ws, { t: 'room', room: s.game.roomDef() });
      ws.roomSent = s.game.roomIndex;
    }
    if (LAG > 0) setTimeout(() => sendRaw(ws, payload), LAG);
    else sendRaw(ws, payload);
  }
}

function send(ws, obj) {
  sendRaw(ws, JSON.stringify(obj));
}

function sendRaw(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(data);
}

// ---------------------------------------------------------------------- WS
wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).slice(2, 8);
  ws.isAlive = true;
  ws.session = null;
  ws.playerId = null;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'ping') {
      send(ws, { t: 'pong', ts: msg.ts });
      return;
    }

    if (msg.t === 'join') {
      joinSession(ws, msg);
      return;
    }

    const s = ws.session;
    const game = s?.game;
    const p = game?.players.get(ws.playerId);
    if (!s || !game || !p) return;

    if (msg.t === 'input') {
      // Fila com limite: descarta o mais antigo em caso de rajada.
      const inp = {
        mx: Math.max(-1, Math.min(1, Number(msg.mx) || 0)),
        my: Math.max(-1, Math.min(1, Number(msg.my) || 0)),
        dash: !!msg.dash,
        attack: !!msg.attack,
        block: !!msg.block,
        interact: !!msg.interact,
        use1: !!msg.use1,
        use2: !!msg.use2,
      };
      p.queue.push({ seq: Number(msg.seq) || 0, inp });
      if (p.queue.length > 16) p.queue.shift();
      return;
    }

    if (msg.t === 'inv') {
      game.handleInv(p, msg);
      return;
    }
  });

  ws.on('close', () => {
    const s = ws.session;
    if (!s || !ws.playerId) return;
    s.clients.delete(ws);
    const p = s.game.players.get(ws.playerId);
    if (!p) return;
    // Carência de 120s: o personagem fica no mundo, invulnerável e parado.
    p.disconnected = true;
    p.invT = 999;
    p.queue.length = 0;
    p.vx = 0;
    p.vy = 0;
    p.lastMx = 0;
    p.lastMy = 0;
    const token = ws.token;
    if (token) {
      const timer = setTimeout(() => {
        s.game.removePlayer(p.id);
        s.disconnected.delete(token);
        console.log(`[sessão ${s.code}] ${p.name} expirou e saiu.`);
      }, 120_000);
      s.disconnected.set(token, { playerId: p.id, timer });
      sendToSession(s, { t: 'partner_lost', name: p.name });
      console.log(`[sessão ${s.code}] ${p.name} desconectou (120s de carência).`);
    }
    s.game.save();
  });
});

function sendToSession(s, obj) {
  for (const ws of s.clients) send(ws, obj);
}

function joinSession(ws, msg) {
  const code = String(msg.code || 'AMIGOS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'AMIGOS';
  const s = getSession(code);
  const game = s.game;

  // Reconexão com token
  if (msg.token && s.disconnected.has(msg.token)) {
    const entry = s.disconnected.get(msg.token);
    const p = game.players.get(entry.playerId);
    if (p) {
      clearTimeout(entry.timer);
      s.disconnected.delete(msg.token);
      p.disconnected = false;
      p.invT = 2;
      ws.session = s;
      ws.playerId = p.id;
      ws.token = msg.token;
      ws.roomSent = -1;
      s.clients.add(ws);
      send(ws, {
        t: 'welcome',
        id: p.id,
        token: msg.token,
        resumed: true,
        code,
        room: game.roomDef(),
        snap: game.buildSnapshot(),
      });
      sendToSession(s, { t: 'partner_back', name: p.name });
      console.log(`[sessão ${code}] ${p.name} reconectou.`);
      return;
    }
  }

  if (game.players.size >= 2) {
    send(ws, { t: 'full' });
    return;
  }

  const kit = KITS[msg.kit] ? msg.kit : 'vanguard';
  const name = String(msg.name || 'Jogador').slice(0, 14);
  const id = 'p' + Math.random().toString(36).slice(2, 7);
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const p = game.addPlayer(id, name, kit);
  p.invT = 2;
  ws.session = s;
  ws.playerId = id;
  ws.token = token;
  ws.roomSent = -1;
  s.clients.add(ws);

  send(ws, {
    t: 'welcome',
    id,
    token,
    code,
    room: game.roomDef(),
    snap: game.buildSnapshot(),
  });
  sendToSession(s, { t: 'partner_join', name });
  console.log(`[sessão ${code}] ${name} entrou como ${kit}. (${game.players.size}/2)`);
}

// Heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 20_000);

// Encerramento limpo: salva todas as sessões.
function shutdown() {
  for (const s of sessions.values()) {
    s.game.save();
    clearInterval(s.loop);
  }
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  console.log('──────────────────────────────────────────────');
  console.log('  Aventura 2D — servidor autoritativo online');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Rede:    http://${ip}:${PORT}`);
  if (LAG) console.log(`  Latência artificial: ${LAG}ms`);
  console.log('──────────────────────────────────────────────');
});
