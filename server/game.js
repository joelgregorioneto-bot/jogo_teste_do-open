// Núcleo autoritativo da partida. Roda a 60Hz no servidor.
// O cliente só envia intenções; tudo aqui é validado e replicado.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DT, KITS, ITEM_DEFS, TILE, PLAYER_MAX_SLOTS, ITEM_PICKUP_RANGE,
  REVIVE_TIME, DOWNED_TIME, RESPAWN_TIME, DOOR_DWELL, TRADE_RANGE,
} from '../shared/constants.js';
import {
  stepPlayer, separatePlayers, inArc, dist, clamp, circleRect, pointInRect,
} from '../shared/sim.js';
import { getRoom, ROOMS, safeSpot } from './rooms.js';

const uid = () => crypto.randomUUID().slice(0, 8);

const ENEMY_DEFS = {
  moss: { hp: 8, halfW: 10, halfH: 11, speed: 40, dmg: 4, arc: 1.7, range: 26 },
  eye: { hp: 4, halfW: 8, halfH: 8, speed: 46, dmg: 4, arc: 0, range: 0 },
  beetle: { hp: 6, halfW: 12, halfH: 9, speed: 34, dmg: 8, arc: 0, range: 0 },
  toad: { hp: 5, halfW: 10, halfH: 10, speed: 32, dmg: 4, arc: 0, range: 0 },
  boss: { hp: 50, halfW: 22, halfH: 18, speed: 34, dmg: 6, arc: 0, range: 0 },
};

function makePlayer(id, name, kitId, spawn) {
  const kit = KITS[kitId] || KITS.vanguard;
  return {
    id,
    name: name || kit.name,
    kit: kit.id,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    halfW: kit.halfW,
    halfH: kit.halfH,
    hp: kit.maxHp,
    maxHp: kit.maxHp,
    facing: { x: 1, y: 0 },
    dashT: 0,
    dashDirX: 1,
    dashDirY: 0,
    dashCd: 0,
    invT: 1.5,
    atkT: 0,
    atkCd: 0,
    blocking: false,
    downed: false,
    downedT: 0,
    reviveT: 0,
    dead: false,
    deadT: 0,
    animT: 0,
    moving: false,
    rootedT: 0,
    markT: 0,
    hurtT: 0,
    hitFlash: 0,
    coins: 0,
    lanternOn: false,
    inv: {
      slots: new Array(PLAYER_MAX_SLOTS).fill(null),
      quick: [null, null],
      tool: null,
    },
    input: { mx: 0, my: 0, dash: false, attack: false, block: false, interact: false, use1: false, use2: false },
    lastMx: 0,
    lastMy: 0,
    lastBlock: false,
    queue: [],
    ack: 0,
    lastSentRoom: -1,
    inCombatT: 0,
    lastInteract: false,
    checkpointTouch: 0,
  };
}

function makeEnemy(type, x, y, scaleHp) {
  const d = ENEMY_DEFS[type];
  const hp = Math.round(d.hp * scaleHp);
  return {
    id: uid(),
    type,
    x, y,
    spawnX: x,
    spawnY: y,
    vx: 0,
    vy: 0,
    halfW: d.halfW,
    halfH: d.halfH,
    hp,
    maxHp: hp,
    speed: d.speed,
    dmg: d.dmg,
    facing: { x: 0, y: 1 },
    state: 'idle',
    stateT: 0,
    atkCd: 1.2,
    stunT: 0,
    hitFlash: 0,
    animT: Math.random() * 10,
    weak: false,
    chargeDirX: 0,
    chargeDirY: 0,
    phase: 1,
    tongue: null,
    lockedId: null,
    lockT: 0,
    scaleHp,
  };
}

export class Game {
  constructor(code, opts = {}) {
    this.code = code;
    this.opts = opts;
    this.players = new Map();
    this.roomIndex = 0;
    this.time = 0;
    this.tickCount = 0;
    this.enemies = [];
    this.projectiles = [];
    this.items = [];
    this.pools = [];
    this.events = [];
    this.tradeOffers = new Map();
    this.ledger = [];
    this.world = {
      keys: 0,
      taken: new Set(),
      checkpoint: { room: 0, x: 0, y: 0 },
      bossDead: false,
      victory: false,
      gates: {},
    };
    this.doorDwell = 0;
    this.wipeT = 0;
    this.bossIntroT = 0;
    this.resetRoom(0, true);
  }

  get room() {
    return getRoom(this.roomIndex);
  }

  get playerCount() {
    return this.players.size;
  }

  // ---------------------------------------------------------------- jogadores
  addPlayer(id, name, kitId) {
    const room = this.room;
    const base = room.start;
    const offset = this.players.size === 0 ? 0 : 18;
    const p = makePlayer(id, name, kitId, { x: base.x + offset, y: base.y });
    if (this.players.size > 0) {
      // Se já existe alguém, nasce ao lado do checkpoint/parceiro atual.
      const other = [...this.players.values()][0];
      p.x = clamp(other.x + 20, TILE, room.w - TILE);
      p.y = other.y;
      p.hp = p.maxHp;
      p.checkpointTouch = 0;
    }
    this.players.set(id, p);
    this.emit({ type: 'join', x: p.x, y: p.y, kit: p.kit });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    // Ferramenta pessoal passa para o parceiro (regra anti-bloqueio).
    const tools = [];
    if (p.inv.tool) tools.push(p.inv.tool);
    for (const s of p.inv.slots) if (s && ITEM_DEFS[s.type]?.tool) tools.push(s);
    const partner = [...this.players.values()].find((o) => o.id !== id);
    if (partner) {
      for (const t of tools) {
        if (!partner.inv.tool) partner.inv.tool = t;
        else if (!this.addItem(partner, t)) this.dropItem(partner, t);
      }
      this.emit({ type: 'tool_transfer', to: partner.id });
    }
    this.players.delete(id);
    this.tradeOffers.delete(id);
    for (const [k, o] of this.tradeOffers) if (o.to === id) this.tradeOffers.delete(k);
  }

  // ------------------------------------------------------------------ itens
  itemInstance(type) {
    return { iid: uid(), type, qty: 1 };
  }

  addItem(p, item) {
    const def = ITEM_DEFS[item.type];
    if (!def) return false;
    if (item.type === 'key_big') {
      this.world.keys += 1;
      this.emit({ type: 'key', x: p.x, y: p.y, player: p.id });
      return true;
    }
    if (def.stack > 1) {
      for (const s of p.inv.slots) {
        if (s && s.type === item.type && s.qty < def.stack) {
          s.qty += item.qty;
          return true;
        }
      }
      for (let i = 0; i < p.inv.quick.length; i++) {
        const q = p.inv.quick[i];
        if (q && q.type === item.type && q.qty < def.stack) {
          q.qty += item.qty;
          return true;
        }
      }
    }
    if (item.type === 'potion') {
      for (let i = 0; i < p.inv.quick.length; i++) {
        if (!p.inv.quick[i]) {
          p.inv.quick[i] = item;
          return true;
        }
      }
    }
    const free = p.inv.slots.findIndex((s) => !s);
    if (free >= 0) {
      p.inv.slots[free] = item;
      return true;
    }
    return false;
  }

  dropItem(p, item) {
    this.items.push({
      id: uid(),
      type: item.type,
      qty: item.qty,
      x: p.x + p.facing.x * 14,
      y: p.y + p.facing.y * 14 + 6,
      reservedBy: p.id,
      reserveT: 1.5,
      spawnT: 0,
    });
  }

  // --------------------------------------------------------------- spawn sala
  resetRoom(index, first = false) {
    this.roomIndex = index;
    const room = this.room;
    const scale = this.playerCount === 2 ? 1.7 : 1;
    this.enemies = [];
    this.projectiles = [];
    this.pools = [];
    this.items = [];
    this.events.push({ type: 'room', room: index, name: room.name, biome: room.biome });

    for (let i = 0; i < room.spawns.length; i++) {
      const s = room.spawns[i];
      const e = makeEnemy(s.type, s.x, s.y, scale);
      if (s.type === 'boss' && this.world.bossDead) continue;
      this.enemies.push(e);
    }
    for (let i = 0; i < room.items.length; i++) {
      const it = room.items[i];
      const key = `r${index}_${i}`;
      if (this.world.taken.has(key)) continue;
      this.items.push({
        id: key,
        type: it.type,
        qty: 1,
        x: it.x,
        y: it.y,
        reservedBy: null,
        reserveT: 0,
        spawnT: 0,
      });
    }
    if (first) {
      this.world.checkpoint = { room: index, x: room.start.x, y: room.start.y };
    }
  }

  // ------------------------------------------------------------------- tick
  tick() {
    this.tickCount += 1;
    this.time += DT;
    const room = this.room;

    for (const p of this.players.values()) {
      this.updatePlayer(p, room);
    }
    const list = [...this.players.values()];
    if (list.length === 2) separatePlayers(list[0], list[1]);

    this.updateRevives(list);
    this.updateEnemies(room);
    this.updateProjectiles(room);
    this.updatePools();
    this.updateHazards(room, list);
    this.updateItems();
    this.updateTradeOffers();
    this.checkDoors(room, list);
    this.checkWipe(list);
    this.checkCombat(list);
  }

  updatePlayer(p, room) {
    // Fila de inputs: consome 1 por tick, garante ack correto.
    let fresh = p.queue.shift();
    let inp;
    if (fresh) {
      inp = fresh.inp;
      p.ack = fresh.seq;
      p.lastMx = inp.mx;
      p.lastMy = inp.my;
      p.lastBlock = inp.block;
    } else {
      inp = { mx: p.lastMx, my: p.lastMy, block: p.lastBlock };
    }

    if (p.rootedT > 0) {
      p.rootedT -= DT;
      inp = { mx: 0, my: 0, block: false };
    }

    if (p.dead) {
      p.deadT -= DT;
      p.vx = 0;
      p.vy = 0;
      if (p.deadT <= 0) this.respawnPlayer(p, 0.5);
      return;
    }

    stepPlayer(p, inp, room.solids, DT);

    // limites da sala
    p.x = clamp(p.x, p.halfW, room.w - p.halfW);
    p.y = clamp(p.y, p.halfH, room.h - p.halfH);

    p.hurtT = Math.max(0, p.hurtT - DT);
    p.hitFlash = Math.max(0, p.hitFlash - DT);
    p.markT = Math.max(0, p.markT - DT);

    if (fresh) {
      if (inp.attack && p.atkCd <= 0 && p.dashT <= 0 && !p.downed) {
        this.playerAttack(p);
      }
      if (inp.interact && !p.lastInteract) this.interact(p, room);
      p.lastInteract = !!inp.interact;
      if (inp.use1) this.useQuick(p, 0);
      if (inp.use2) this.useQuick(p, 1);
    }

    // checkpoint por proximidade + interação
    if (room.checkpoint) {
      const d = dist(p.x, p.y, room.checkpoint.x, room.checkpoint.y);
      p.checkpointTouch = d < 26 ? 1 : 0;
    }
  }

  playerAttack(p) {
    const kit = KITS[p.kit];
    p.atkCd = kit.attackCd;
    p.atkT = 0.28;
    p.attackSeq = (p.attackSeq || 0) + 1;

    if (p.kit === 'scout') {
      this.projectiles.push({
        id: uid(),
        type: 'dagger',
        owner: p.id,
        x: p.x + p.facing.x * 12,
        y: p.y + p.facing.y * 12,
        vx: p.facing.x * 230,
        vy: p.facing.y * 230,
        dmg: 2,
        life: 1.1,
        mark: true,
        dirX: p.facing.x,
        dirY: p.facing.y,
      });
      this.emit({ type: 'shoot', x: p.x, y: p.y, kind: 'dagger', player: p.id });
      return;
    }

    // Vanguarda: arco curto à frente
    this.emit({ type: 'swing', x: p.x, y: p.y, fx: p.facing.x, fy: p.facing.y, player: p.id });
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (!inArc(p, e, kit.attackRange + e.halfW, kit.attackArc, p.facing)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      this.hurtEnemy(e, kit.attackDmg, p, { dx, dy, melee: true });
    }
  }

  useQuick(p, index) {
    const item = p.inv.quick[index];
    if (!item) return;
    const def = ITEM_DEFS[item.type];
    if (item.type === 'potion') {
      if (p.hp >= p.maxHp) {
        this.emit({ type: 'deny', x: p.x, y: p.y, why: 'vida cheia' });
        return;
      }
      p.hp = Math.min(p.maxHp, p.hp + def.heal);
      item.qty -= 1;
      if (item.qty <= 0) p.inv.quick[index] = null;
      this.emit({ type: 'heal', x: p.x, y: p.y, player: p.id, amount: def.heal });
    }
  }

  hasTool(p, type) {
    if (p.inv.tool && p.inv.tool.type === type) return true;
    return p.inv.slots.some((s) => s && s.type === type);
  }

  consumeTool(p, type) {
    if (p.inv.tool && p.inv.tool.type === type) {
      p.inv.tool.qty -= 1;
      if (p.inv.tool.qty <= 0) p.inv.tool = null;
      return true;
    }
    for (let i = 0; i < p.inv.slots.length; i++) {
      const s = p.inv.slots[i];
      if (s && s.type === type) {
        s.qty -= 1;
        if (s.qty <= 0) p.inv.slots[i] = null;
        return true;
      }
    }
    return false;
  }

  interact(p, room) {
    if (p.downed || p.dead) return;

    // 1) Reanimar parceiro
    const partner = [...this.players.values()].find((o) => o.id !== p.id && o.downed && !o.dead);
    if (partner && dist(p.x, p.y, partner.x, partner.y) < 28) {
      p.reviving = partner.id;
      return;
    }

    // 2) Pegar item
    let closest = null;
    let cd = ITEM_PICKUP_RANGE;
    for (const it of this.items) {
      const d = dist(p.x, p.y, it.x, it.y);
      if (d < cd && !ITEM_DEFS[it.type]?.auto) {
        closest = it;
        cd = d;
      }
    }
    if (closest) {
      if (closest.reservedBy && closest.reservedBy !== p.id && closest.reserveT > 0) {
        this.emit({ type: 'deny', x: closest.x, y: closest.y, why: 'reservado' });
        return;
      }
      this.takeItem(p, closest);
      return;
    }

    // 3) Checkpoint
    if (room.checkpoint && dist(p.x, p.y, room.checkpoint.x, room.checkpoint.y) < 26) {
      this.activateCheckpoint(p, room);
      return;
    }

    // 4) Bomba em parede rachada
    if (this.hasTool(p, 'bomb')) {
      const breakable = room.solids.find((s) => s.breakable && this.nearRect(p, s, 34));
      if (breakable) {
        this.consumeTool(p, 'bomb');
        this.projectiles.push({
          id: uid(), type: 'bomb', owner: p.id, x: p.x, y: p.y,
          vx: 0, vy: 0, dmg: 0, life: 1.2, fuse: 1.2, dirX: 0, dirY: 0,
        });
        this.emit({ type: 'bomb_place', x: p.x, y: p.y });
        return;
      }
    }

    // 5) Lanterna (liga/desliga)
    if (this.hasTool(p, 'lantern')) {
      p.lanternOn = !p.lanternOn;
      this.emit({ type: 'lantern', player: p.id, on: p.lanternOn });
      return;
    }

    // 6) Gancho: avanço rápido com i-frames
    if (this.hasTool(p, 'grapple') && p.dashCd <= 0 && p.dashT <= 0) {
      p.dashT = 0.2;
      p.dashDirX = p.facing.x;
      p.dashDirY = p.facing.y;
      p.dashCd = 1.2;
      p.invT = Math.max(p.invT, 0.24);
      this.emit({ type: 'grapple', x: p.x, y: p.y, dx: p.facing.x, dy: p.facing.y });
      return;
    }
  }

  nearRect(p, r, pad) {
    return (
      p.x + p.halfW > r.x - pad && p.x - p.halfW < r.x + r.w + pad &&
      p.y + p.halfH > r.y - pad && p.y - p.halfH < r.y + r.h + pad
    );
  }

  takeItem(p, it) {
    const idx = this.items.indexOf(it);
    if (idx < 0) return;
    const item = this.itemInstance(it.type);
    item.qty = it.qty || 1;
    const ok = this.addItem(p, item);
    if (!ok) {
      this.emit({ type: 'deny', x: p.x, y: p.y, why: 'inventário cheio' });
      return;
    }
    this.items.splice(idx, 1);
    this.world.taken.add(it.id);
    this.ledger.push({ t: this.time, action: 'pickup', iid: item.iid, type: item.type, to: p.id });
    this.emit({ type: 'pickup', x: it.x, y: it.y, kind: it.type, player: p.id, iid: item.iid });
    if (it.type === 'potion') this.emit({ type: 'hint', text: `${p.name} pegou uma Poção (tecla 1)` });
  }

  activateCheckpoint(p, room) {
    if (p.checkpointCd > 0) return;
    p.checkpointCd = 1.5;
    this.world.checkpoint = { room: this.roomIndex, x: room.checkpoint.x, y: room.checkpoint.y };
    for (const o of this.players.values()) {
      o.hp = o.maxHp;
      o.downed = false;
      o.dead = false;
      o.downedT = 0;
      o.reviveT = 0;
      o.invT = 1;
    }
    this.emit({ type: 'checkpoint', x: room.checkpoint.x, y: room.checkpoint.y });
    this.save();
  }

  respawnPlayer(p, hpFrac) {
    const cp = this.world.checkpoint;
    if (this.roomIndex !== cp.room) {
      this.roomIndex = cp.room;
      this.resetRoom(cp.room);
    }
    p.x = cp.x + (this.players.size > 1 ? 16 : 0);
    p.y = cp.y;
    p.hp = Math.max(4, Math.round(p.maxHp * hpFrac));
    p.downed = false;
    p.dead = false;
    p.downedT = 0;
    p.reviveT = 0;
    p.invT = 2;
    p.vx = 0;
    p.vy = 0;
    this.emit({ type: 'respawn', x: p.x, y: p.y, player: p.id });
  }

  updateRevives(list) {
    for (const p of list) {
      if (p.downed && !p.dead) {
        p.downedT += DT;
        const partner = list.find((o) => o.id !== p.id && !o.downed && !o.dead);
        const near = partner && dist(p.x, p.y, partner.x, partner.y) < 28;
        if (near && partner.reviving === p.id) {
          p.reviveT += DT;
          if (p.reviveT >= REVIVE_TIME) {
            p.downed = false;
            p.downedT = 0;
            p.reviveT = 0;
            p.hp = Math.max(4, Math.round(p.maxHp * 0.5));
            p.invT = 2;
            partner.invT = Math.max(partner.invT, 1);
            this.emit({ type: 'revive', x: p.x, y: p.y, player: p.id });
          }
        } else {
          p.reviveT = Math.max(0, p.reviveT - DT * 0.6);
        }
        if (p.downedT > DOWNED_TIME) {
          p.downed = false;
          p.dead = true;
          p.deadT = RESPAWN_TIME;
          this.emit({ type: 'death', x: p.x, y: p.y, player: p.id });
        }
      }
      if (p.reviving) {
        const target = this.players.get(p.reviving);
        if (!target || !target.downed || dist(p.x, p.y, target.x, target.y) > 32) {
          p.reviving = null;
        }
      }
      p.checkpointCd = Math.max(0, (p.checkpointCd || 0) - DT);
    }
  }

  // ------------------------------------------------------------------ dano
  hurtPlayer(p, amount, source = {}) {
    if (!p || p.invT > 0 || p.downed || p.dead) return false;
    p.hp -= amount;
    p.invT = 0.6;
    p.hurtT = 0.25;
    p.hitFlash = 0.2;
    this.emit({ type: 'hurt', x: p.x, y: p.y, player: p.id, amount, source: source.type || 'hit' });
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.downedT = 0;
      p.reviveT = 0;
      p.dead = false;
      p.blocking = false;
      this.emit({ type: 'downed', x: p.x, y: p.y, player: p.id });
    }
    return true;
  }

  hurtEnemy(e, amount, from, hit = {}) {
    if (e.hp <= 0) return 0;
    let dmg = amount;
    let weak = false;
    const dx = hit.dx ?? e.x - from.x;
    const dy = hit.dy ?? e.y - from.y;
    const dl = Math.hypot(dx, dy) || 1;
    const nx = dx / dl;
    const ny = dy / dl;

    if (e.type === 'eye') {
      // Escudo frontal: só entra dano por trás.
      const dot = nx * e.facing.x + ny * e.facing.y;
      if (dot > 0.25) {
        this.emit({ type: 'block', x: e.x, y: e.y });
        return 0;
      }
      weak = true;
      dmg *= 1.5;
    }

    if (e.type === 'moss' && ['windup', 'attack', 'recover'].includes(e.state)) {
      const dot = nx * e.facing.x + ny * e.facing.y;
      if (dot < -0.25) {
        weak = true;
        dmg *= 2;
        e.stunT = Math.max(e.stunT, 1);
        this.emit({ type: 'weak', x: e.x, y: e.y, kind: 'back' });
      }
    }

    if (e.type === 'beetle' && e.state === 'stunned') {
      weak = true;
      dmg *= 2;
    }

    if ((e.type === 'toad' || e.type === 'boss') && e.tongue) {
      e.tongue = null;
      e.stunT = Math.max(e.stunT, 1.1);
      const held = [...this.players.values()].find((p) => p.rootedT > 0);
      if (held) held.rootedT = 0;
      this.emit({ type: 'tongue_break', x: e.x, y: e.y });
    }

    if (e.type === 'boss' && e.state === 'recover') {
      weak = true;
      dmg *= 1.5;
    }

    if (from && from.markT > 0 && e.type !== 'boss') dmg *= 1.15;

    e.hp -= dmg;
    e.hitFlash = 0.18;
    e.weak = weak;
    this.emit({
      type: 'hit', x: e.x, y: e.y, amount: dmg, weak,
      enemy: e.id, kind: e.type, player: from?.id,
    });

    if (e.hp <= 0) this.killEnemy(e, from);
    else if (e.type !== 'boss') this.onAggro(e, from);
    return dmg;
  }

  killEnemy(e, from) {
    e.hp = 0;
    this.emit({ type: 'kill', x: e.x, y: e.y, kind: e.type, player: from?.id });
    // Loot: moedas para quem matou + chance de poção
    if (from && e.type !== 'boss') {
      const coins = e.type === 'beetle' ? 3 : e.type === 'eye' ? 2 : 2;
      from.coins += coins;
      this.emit({ type: 'coin', x: e.x, y: e.y, player: from.id, amount: coins });
    }
    if (Math.random() < 0.18 && e.type !== 'boss') {
      this.items.push({
        id: uid(), type: 'potion', qty: 1, x: e.x, y: e.y,
        reservedBy: from?.id || null, reserveT: 2, spawnT: 0,
      });
    }
    if (e.type === 'boss') {
      this.world.bossDead = true;
      this.world.victory = true;
      this.bossIntroT = 0;
      this.emit({ type: 'victory', x: e.x, y: e.y });
      this.save();
    }
  }

  onAggro(e, from) {
    if (!from) return;
    if (e.type === 'eye') e.lockedId = from.id;
  }

  // ---------------------------------------------------------------- inimigos
  nearestPlayer(x, y) {
    let best = null;
    let bd = Infinity;
    for (const p of this.players.values()) {
      if (p.downed || p.dead) continue;
      const d = dist(x, y, p.x, p.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  moveEnemy(e, dt, room) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    // colisão simples com sólidos
    for (const s of room.solids) {
      if (
        e.x + e.halfW > s.x && e.x - e.halfW < s.x + s.w &&
        e.y + e.halfH > s.y && e.y - e.halfH < s.y + s.h
      ) {
        // empurra de volta pelo eixo de menor penetração
        const ox = Math.min(e.x + e.halfW - s.x, s.x + s.w - (e.x - e.halfW));
        const oy = Math.min(e.y + e.halfH - s.y, s.y + s.h - (e.y - e.halfH));
        if (ox < oy) {
          e.x += e.x < s.x + s.w / 2 ? -ox : ox;
          e.vx = 0;
        } else {
          e.y += e.y < s.y + s.h / 2 ? -oy : oy;
          e.vy = 0;
        }
      }
    }
    e.x = clamp(e.x, e.halfW, room.w - e.halfW);
    e.y = clamp(e.y, e.halfH, room.h - e.halfH);
    // separação entre inimigos
    for (const o of this.enemies) {
      if (o === e || o.hp <= 0) continue;
      const dx = o.x - e.x;
      const dy = o.y - e.y;
      const d = Math.hypot(dx, dy);
      const min = e.halfW + o.halfW;
      if (d > 0.01 && d < min) {
        const push = (min - d) / 2;
        e.x -= (dx / d) * push;
        e.y -= (dy / d) * push;
      }
    }
  }

  face(e, tx, ty) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const l = Math.hypot(dx, dy) || 1;
    e.facing.x = dx / l;
    e.facing.y = dy / l;
  }

  updateEnemies(room) {
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      e.animT += DT;
      e.hitFlash = Math.max(0, e.hitFlash - DT);
      e.atkCd = Math.max(0, e.atkCd - DT);
      if (e.stunT > 0) {
        e.stunT -= DT;
        e.vx = 0;
        e.vy = 0;
        e.state = e.type === 'beetle' ? 'stunned' : 'idle';
        e.weak = e.type === 'beetle';
        continue;
      }
      e.weak = false;
      e.stateT -= DT;
      e.vx = 0;
      e.vy = 0;
      const target = this.nearestPlayer(e.x, e.y);
      if (!target) {
        e.state = 'idle';
        continue;
      }
      const d = dist(e.x, e.y, target.x, target.y);
      switch (e.type) {
        case 'moss': this.aiMoss(e, target, d, room); break;
        case 'eye': this.aiEye(e, target, d, room); break;
        case 'beetle': this.aiBeetle(e, target, d, room); break;
        case 'toad': this.aiToad(e, target, d, room); break;
        case 'boss': this.aiBoss(e, target, d, room); break;
      }
      this.moveEnemy(e, DT, room);
      // Investida que bateu na parede vira atordoamento (ventre exposto).
      if (e.type === 'beetle' && e.state === 'charge' && Math.abs(e.vx) + Math.abs(e.vy) < 40) {
        e.state = 'stunned';
        e.stateT = 1.2;
        e.stunT = 1.2;
        e.vx = 0;
        e.vy = 0;
        this.emit({ type: 'weak', x: e.x, y: e.y, kind: 'wall' });
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  aiMoss(e, target, d, room) {
    switch (e.state) {
      case 'idle':
        if (d < 150) e.state = 'chase';
        break;
      case 'chase':
        this.face(e, target.x, target.y);
        if (d > 12) {
          e.vx = e.facing.x * e.speed;
          e.vy = e.facing.y * e.speed;
        }
        if (d < 30 && e.atkCd <= 0) {
          e.state = 'windup';
          e.stateT = 0.45;
          e.atkCd = 1.5;
        } else if (d > 220) e.state = 'idle';
        break;
      case 'windup':
        this.face(e, target.x, target.y);
        e.vx = e.facing.x * 12;
        e.vy = e.facing.y * 12;
        if (e.stateT <= 0) {
          e.state = 'attack';
          e.stateT = 0.2;
          this.enemyMelee(e, 30, 1.8, room);
        }
        break;
      case 'attack':
        if (e.stateT <= 0) {
          e.state = 'recover';
          e.stateT = 0.55;
        }
        break;
      case 'recover':
        if (e.stateT <= 0) e.state = 'chase';
        break;
      default:
        e.state = 'idle';
    }
  }

  enemyMelee(e, range, arc, room) {
    for (const p of this.players.values()) {
      if (p.downed || p.dead) continue;
      if (inArc(e, p, range, arc, e.facing)) this.hurtPlayer(p, e.dmg, { type: e.type });
    }
    this.emit({ type: 'enemy_attack', x: e.x, y: e.y, kind: e.type, fx: e.facing.x, fy: e.facing.y });
  }

  aiEye(e, target, d, room) {
    const preferred = 90;
    if (e.state === 'aim') {
      this.face(e, target.x, target.y);
      if (e.stateT <= 0) {
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const l = Math.hypot(dx, dy) || 1;
        this.projectiles.push({
          id: uid(), type: 'crystal', owner: e.id, enemy: true,
          x: e.x, y: e.y, vx: (dx / l) * 90, vy: (dy / l) * 90,
          dmg: e.dmg, life: 3, dirX: dx / l, dirY: dy / l,
        });
        this.emit({ type: 'shoot', x: e.x, y: e.y, kind: 'crystal' });
        e.state = 'idle';
        e.stateT = 0.6;
        e.atkCd = 1.8;
      }
      return;
    }
    if (d < preferred - 25) {
      this.face(e, target.x, target.y);
      e.vx = -e.facing.x * e.speed;
      e.vy = -e.facing.y * e.speed;
    } else if (d > preferred + 25) {
      this.face(e, target.x, target.y);
      e.vx = e.facing.x * e.speed;
      e.vy = e.facing.y * e.speed;
    } else {
      this.face(e, target.x, target.y);
      // flutua lateralmente
      e.vx = -e.facing.y * 18;
      e.vy = e.facing.x * 18;
    }
    if (e.atkCd <= 0 && d < 190) {
      e.state = 'aim';
      e.stateT = 0.9;
      e.lockedId = target.id;
    }
  }

  aiBeetle(e, target, d, room) {
    switch (e.state) {
      case 'idle':
        if (d < 180) {
          e.state = 'dig';
          e.stateT = 0.5;
          this.face(e, target.x, target.y);
        }
        break;
      case 'dig':
        this.face(e, target.x, target.y);
        if (e.stateT <= 0) {
          e.state = 'charge';
          e.stateT = 1.3;
          e.chargeDirX = e.facing.x;
          e.chargeDirY = e.facing.y;
          e.vx = e.chargeDirX * 240;
          e.vy = e.chargeDirY * 240;
        }
        break;
      case 'charge': {
        e.vx = e.chargeDirX * 240;
        e.vy = e.chargeDirY * 240;
        const beforeX = e.x;
        const beforeY = e.y;
        // colisão é resolvida em moveEnemy; detectamos parede pelo deslocamento
        if (e.stateT <= 0) {
          e.state = 'stunned';
          e.stateT = 1.2;
          e.stunT = 1.2;
          e.atkCd = 2;
        }
        e._prevX = beforeX;
        e._prevY = beforeY;
        break;
      }
      case 'stunned':
        if (e.stateT <= 0) {
          e.state = 'idle';
          e.atkCd = 1.4;
        }
        break;
      default:
        e.state = 'idle';
    }
    // dano de investida por contato
    if (e.state === 'charge') {
      for (const p of this.players.values()) {
        if (p.downed || p.dead) continue;
        if (dist(e.x, e.y, p.x, p.y) < e.halfW + p.halfW + 2) {
          if (this.hurtPlayer(p, e.dmg, { type: 'beetle' })) {
            e.state = 'stunned';
            e.stateT = 1.2;
            e.stunT = 1.2;
            this.emit({ type: 'weak', x: e.x, y: e.y, kind: 'wall' });
          }
        }
      }
      // parede: perdeu velocidade
      if (Math.abs(e.vx) + Math.abs(e.vy) < 40) {
        e.state = 'stunned';
        e.stateT = 1.2;
        e.stunT = 1.2;
        this.emit({ type: 'weak', x: e.x, y: e.y, kind: 'wall' });
      }
    }
  }

  aiToad(e, target, d, room) {
    if (e.tongue) {
      const held = this.players.get(e.tongue.targetId);
      if (!held || held.rootedT <= 0) {
        e.tongue = null;
        return;
      }
      // a língua puxa o jogador para perto
      const dx = e.x - held.x;
      const dy = e.y - held.y;
      const l = Math.hypot(dx, dy) || 1;
      held.x += (dx / l) * 26 * DT;
      held.y += (dy / l) * 26 * DT;
      if (dist(e.x, e.y, held.x, held.y) < 18) {
        this.hurtPlayer(held, 2, { type: 'tongue' });
        held.rootedT = 0;
        e.tongue = null;
      }
      return;
    }

    if (d < 66) {
      this.face(e, target.x, target.y);
      e.vx = -e.facing.x * e.speed;
      e.vy = -e.facing.y * e.speed;
    } else if (d > 110) {
      this.face(e, target.x, target.y);
      e.vx = e.facing.x * e.speed;
      e.vy = e.facing.y * e.speed;
    } else {
      this.face(e, target.x, target.y);
    }

    if (e.state === 'inflate') {
      if (e.stateT <= 0) {
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const l = Math.hypot(dx, dy) || 1;
        this.projectiles.push({
          id: uid(), type: 'acid', owner: e.id, enemy: true,
          x: e.x, y: e.y - 4, vx: (dx / l) * 110, vy: (dy / l) * 110,
          dmg: e.dmg, life: 1.6, dirX: dx / l, dirY: dy / l,
          arc: true, startX: e.x, startY: e.y,
        });
        this.emit({ type: 'shoot', x: e.x, y: e.y, kind: 'acid' });
        e.state = 'idle';
        e.atkCd = 2.2;
      }
      return;
    }

    if (e.atkCd <= 0 && d < 190) {
      e.state = 'inflate';
      e.stateT = 0.6;
      this.emit({ type: 'telegraph', x: e.x, y: e.y, kind: 'toad' });
    } else if (d < 66 && e.atkCd <= 0.6 && (e.tongueCd || 0) <= 0) {
      e.state = 'tongueWindup';
      e.stateT = 0.55;
      this.emit({ type: 'telegraph', x: e.x, y: e.y, kind: 'tongue' });
      e.tongueTargetId = target.id;
    }

    if (e.state === 'tongueWindup') {
      if (e.stateT <= 0) {
        const t = this.players.get(e.tongueTargetId);
        if (t && !t.downed && dist(e.x, e.y, t.x, t.y) < 84) {
          t.rootedT = 1.8;
          e.tongue = { targetId: t.id, x: e.x, y: e.y };
          this.emit({ type: 'tongue', from: { x: e.x, y: e.y }, to: { x: t.x, y: t.y }, target: t.id });
          this.hurtPlayer(t, 2, { type: 'tongue' });
        }
        e.state = 'idle';
        e.tongueCd = 4.5;
        e.atkCd = 1.5;
      }
    }
    e.tongueCd = Math.max(0, (e.tongueCd || 0) - DT);
  }

  aiBoss(e, target, d, room) {
    if (e.hp < e.maxHp * 0.5 && e.phase === 1) {
      e.phase = 2;
      e.speed *= 1.3;
      e.dmg = 6;
      this.emit({ type: 'boss_phase', x: e.x, y: e.y });
    }
    if (e.tongue) {
      const held = this.players.get(e.tongue.targetId);
      if (!held || held.rootedT <= 0) { e.tongue = null; return; }
      const dx = e.x - held.x;
      const dy = e.y - held.y;
      const l = Math.hypot(dx, dy) || 1;
      held.x += (dx / l) * 30 * DT;
      held.y += (dy / l) * 30 * DT;
      if (dist(e.x, e.y, held.x, held.y) < 22) {
        this.hurtPlayer(held, 4, { type: 'tongue' });
        held.rootedT = 0;
        e.tongue = null;
        e.state = 'recover';
        e.stateT = 1.2;
      }
      return;
    }

    this.face(e, target.x, target.y);

    if (e.state === 'windup') {
      if (e.stateT <= 0) {
        if (e.nextAttack === 'slam') {
          this.projectiles.push({
            id: uid(), type: 'shock', owner: e.id, enemy: true,
            x: e.x, y: e.y, vx: 0, vy: 0, dmg: 6, life: 0.1, radius: 46, dirX: 0, dirY: 0,
          });
          this.emit({ type: 'shockwave', x: e.x, y: e.y });
          for (const p of this.players.values()) {
            if (dist(e.x, e.y, p.x, p.y) < 52) this.hurtPlayer(p, 6, { type: 'boss' });
          }
        } else if (e.nextAttack === 'spread') {
          for (let i = -1; i <= 1; i++) {
            const ang = Math.atan2(target.y - e.y, target.x - e.x) + i * 0.28;
            this.projectiles.push({
              id: uid(), type: 'acid', owner: e.id, enemy: true,
              x: e.x, y: e.y, vx: Math.cos(ang) * 105, vy: Math.sin(ang) * 105,
              dmg: 6, life: 2, dirX: Math.cos(ang), dirY: Math.sin(ang),
              arc: true, startX: e.x, startY: e.y,
            });
          }
          this.emit({ type: 'shoot', x: e.x, y: e.y, kind: 'acid' });
        } else if (e.nextAttack === 'tongue') {
          const t = this.players.get(e.tongueTargetId);
          if (t && dist(e.x, e.y, t.x, t.y) < 150) {
            t.rootedT = 1.8;
            e.tongue = { targetId: t.id };
            this.hurtPlayer(t, 4, { type: 'tongue' });
            this.emit({ type: 'tongue', from: { x: e.x, y: e.y }, to: { x: t.x, y: t.y }, target: t.id });
          }
        }
        e.state = 'recover';
        e.stateT = e.phase === 2 ? 0.7 : 1;
        e.atkCd = e.phase === 2 ? 1.6 : 2.3;
      }
      return;
    }

    if (e.state === 'recover') {
      if (e.stateT <= 0) e.state = 'idle';
      return;
    }

    if (e.atkCd <= 0) {
      const r = Math.random();
      if (d < 90) {
        e.nextAttack = 'tongue';
        e.tongueTargetId = target.id;
      } else if (r < 0.4) {
        e.nextAttack = 'slam';
      } else if (r < 0.75 || e.phase === 2) {
        e.nextAttack = 'spread';
      } else {
        e.nextAttack = 'tongue';
        e.tongueTargetId = target.id;
      }
      e.state = 'windup';
      e.stateT = e.nextAttack === 'slam' ? 0.7 : 0.55;
      this.emit({ type: 'telegraph', x: e.x, y: e.y, kind: 'boss', attack: e.nextAttack });
      return;
    }

    const preferred = 110;
    if (d > preferred) {
      e.vx = e.facing.x * e.speed;
      e.vy = e.facing.y * e.speed;
    } else if (d < 60) {
      e.vx = -e.facing.x * e.speed * 0.6;
      e.vy = -e.facing.y * e.speed * 0.6;
    }
    if (e.phase === 2 && Math.random() < 0.02) {
      this.pools.push({ id: uid(), x: e.x, y: e.y + 10, r: 22, life: 3, type: 'acid' });
    }
  }

  // ------------------------------------------------------------- projéteis
  updateProjectiles(room) {
    for (const pr of this.projectiles) {
      pr.life -= DT;
      if (pr.type === 'bomb') {
        pr.fuse -= DT;
        if (pr.fuse <= 0) {
          pr.life = 0;
          this.explode(pr, room);
        }
        continue;
      }
      if (pr.type === 'shock') {
        if (pr.life <= 0) { /* dano já aplicado */ }
        continue;
      }
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
      if (pr.arc) pr.y += 0; // arco é só visual no cliente
      if (pr.life <= 0) {
        if (pr.type === 'acid') this.spawnPool(pr.x, pr.y, 'acid', 3);
        continue;
      }
      // paredes
      let blocked = false;
      for (const s of room.solids) {
        if (pointInRect(pr.x, pr.y, s)) { blocked = true; break; }
      }
      if (blocked) {
        if (pr.type === 'acid') this.spawnPool(pr.x, pr.y, 'acid', 3);
        pr.life = 0;
        continue;
      }
      // jogadores
      if (pr.enemy) {
        for (const p of this.players.values()) {
          if (p.downed || p.dead) continue;
          if (dist(pr.x, pr.y, p.x, p.y) < p.halfW + 5) {
            if (this.hurtPlayer(p, pr.dmg, { type: pr.type })) {
              if (pr.type === 'acid') this.spawnPool(pr.x, pr.y, 'acid', 3);
              pr.life = 0;
            }
          }
        }
      } else {
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (dist(pr.x, pr.y, e.x, e.y) < e.halfW + 5) {
            this.hurtEnemy(e, pr.dmg, this.players.get(pr.owner), { dx: pr.dirX, dy: pr.dirY });
            if (pr.mark) {
              const owner = this.players.get(pr.owner);
              if (owner) owner.markT = 3;
              e.markT = 3;
            }
            pr.life = 0;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0 && p.type !== 'shock');
  }

  explode(pr, room) {
    const R = 42;
    this.emit({ type: 'explosion', x: pr.x, y: pr.y, radius: R });
    // quebra paredes rachadas
    for (let i = room.solids.length - 1; i >= 0; i--) {
      const s = room.solids[i];
      if (!s.breakable) continue;
      if (circleRect(pr.x, pr.y, R, s)) {
        room.solids.splice(i, 1);
        this.emit({ type: 'wall_break', x: s.x, y: s.y, w: s.w, h: s.h });
      }
    }
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (dist(pr.x, pr.y, e.x, e.y) < R + e.halfW) {
        this.hurtEnemy(e, 6, this.players.get(pr.owner), { dx: e.x - pr.x, dy: e.y - pr.y });
      }
    }
  }

  spawnPool(x, y, type, life) {
    this.pools.push({ id: uid(), x, y, r: type === 'acid' ? 20 : 24, life, type });
    this.emit({ type: 'pool', x, y, kind: type });
  }

  updatePools() {
    for (const pool of this.pools) {
      pool.life -= DT;
      for (const p of this.players.values()) {
        if (p.downed || p.dead || p.invT > 0) continue;
        if (dist(pool.x, pool.y, p.x, p.y) < pool.r) {
          if (p.poisonCd > 0) continue;
          p.poisonCd = 0.7;
          this.hurtPlayer(p, 2, { type: 'poison' });
        }
      }
    }
    this.pools = this.pools.filter((p) => p.life > 0);
    for (const p of this.players.values()) p.poisonCd = Math.max(0, (p.poisonCd || 0) - DT);
  }

  updateHazards(room, list) {
    for (const p of list) {
      if (p.downed || p.dead) continue;
      if (p.hazardCd > 0) p.hazardCd -= DT;
      for (const h of room.hazards) {
        const inside = pointInRect(p.x, p.y, h);
        if (!inside) continue;
        if (h.type === 'pit') {
          if (p.dashT > 0) continue; // atravessa com dash/gancho
          if (p.invT > 0) continue;
          this.hurtPlayer(p, 4, { type: 'pit' });
          const safe = safeSpot(room, p.x, p.y);
          p.x = safe.x;
          p.y = safe.y;
          p.invT = Math.max(p.invT, 1.2);
          this.emit({ type: 'fall', x: p.x, y: p.y, player: p.id });
        } else if (h.type === 'spikes') {
          if (p.hazardCd <= 0) {
            p.hazardCd = 0.9;
            this.hurtPlayer(p, 4, { type: 'spikes' });
          }
        } else if (h.type === 'poison') {
          if (p.hazardCd <= 0) {
            p.hazardCd = 0.8;
            this.hurtPlayer(p, 2, { type: 'poison' });
          }
        }
      }
    }
  }

  updateItems() {
    for (const it of this.items) {
      it.spawnT += DT;
      it.reserveT = Math.max(0, it.reserveT - DT);
      if (it.type !== 'coin') continue;
      for (const p of this.players.values()) {
        if (p.downed || p.dead) continue;
        if (dist(it.x, it.y, p.x, p.y) < 14) {
          p.coins += 1;
          it._taken = true;
          this.emit({ type: 'coin', x: it.x, y: it.y, player: p.id, amount: 1 });
        }
      }
    }
    this.items = this.items.filter((i) => !i._taken);
  }

  // --------------------------------------------------------------- portas
  checkDoors(room, list) {
    if (list.length < 2) return;
    for (const door of room.doors) {
      const a = list[0];
      const b = list[1];
      const inside = (p) =>
        p.x > door.x && p.x < door.x + door.w && p.y > door.y && p.y < door.y + door.h;
      if (inside(a) && inside(b)) {
        this.doorDwell += DT;
        if (this.doorDwell >= DOOR_DWELL) {
          if (door.needs === 'key_big' && this.world.keys <= 0) {
            this.emit({ type: 'locked', text: 'Precisa da Chave Grande' });
            this.doorDwell = -1.2;
            continue;
          }
          if (door.needs === 'key_big') {
            this.world.keys -= 1;
            this.emit({ type: 'key_used' });
          }
          this.doorDwell = 0;
          this.transitionTo(door);
          return;
        }
      }
    }
    this.doorDwell = Math.max(0, this.doorDwell - DT * 2);
  }

  transitionTo(door) {
    const to = door.to;
    this.roomIndex = to;
    this.resetRoom(to);
    let i = 0;
    for (const p of this.players.values()) {
      p.x = door.entry.x + i * 16;
      p.y = door.entry.y;
      p.vx = 0;
      p.vy = 0;
      p.invT = 1.2;
      p.downed = false;
      p.dead = false;
      p.rootedT = 0;
      i++;
    }
    this.emit({ type: 'transition', room: to, name: this.room.name });
    this.save();
  }

  // ---------------------------------------------------------------- sistema
  checkWipe(list) {
    if (list.length < 2) {
      const p = list[0];
      if (p && p.dead && p.deadT <= 0) this.respawnPlayer(p, 0.5);
      return;
    }
    const allDown = list.every((p) => p.downed || p.dead);
    if (allDown) {
      this.wipeT += DT;
      if (this.wipeT > 4) {
        this.wipeT = 0;
        for (const p of list) this.respawnPlayer(p, 1);
        this.resetRoom(this.roomIndex);
        this.emit({ type: 'wipe' });
      }
    } else {
      this.wipeT = 0;
    }
  }

  checkCombat(list) {
    for (const p of list) {
      let near = false;
      for (const e of this.enemies) {
        if (e.hp > 0 && dist(e.x, e.y, p.x, p.y) < 220) { near = true; break; }
      }
      p.inCombatT = near ? 2 : Math.max(0, p.inCombatT - DT);
    }
  }

  // ------------------------------------------------------------- inventário
  handleInv(p, msg) {
    switch (msg.a) {
      case 'use': return this.invUse(p, msg);
      case 'drop': return this.invDrop(p, msg);
      case 'offer': return this.invOffer(p, msg);
      case 'accept': return this.invAccept(p, msg);
      case 'decline': return this.invDecline(p, msg);
      case 'swap': return this.invSwap(p, msg);
      default: return;
    }
  }

  invUse(p, msg) {
    if (msg.kind === 'quick') return this.useQuick(p, msg.index);
    const item = p.inv.slots[msg.index];
    if (!item) return;
    const def = ITEM_DEFS[item.type];
    if (item.type === 'potion') {
      if (p.hp >= p.maxHp) return;
      p.hp = Math.min(p.maxHp, p.hp + def.heal);
      item.qty -= 1;
      if (item.qty <= 0) p.inv.slots[msg.index] = null;
      this.emit({ type: 'heal', x: p.x, y: p.y, player: p.id, amount: def.heal });
    } else if (def.tool && !p.inv.tool) {
      p.inv.tool = item;
      p.inv.slots[msg.index] = null;
    }
  }

  invDrop(p, msg) {
    const item = msg.kind === 'quick' ? p.inv.quick[msg.index] : p.inv.slots[msg.index];
    if (!item) return;
    if (msg.kind === 'quick') p.inv.quick[msg.index] = null;
    else p.inv.slots[msg.index] = null;
    this.dropItem(p, item);
    this.ledger.push({ t: this.time, action: 'drop', iid: item.iid, from: p.id });
  }

  invSwap(p, msg) {
    const list = msg.kind === 'quick' ? p.inv.quick : p.inv.slots;
    if (msg.a < 0 || msg.b < 0 || msg.a >= list.length || msg.b >= list.length) return;
    const tmp = list[msg.a];
    list[msg.a] = list[msg.b];
    list[msg.b] = tmp;
  }

  invOffer(p, msg) {
    if (this.playerCount < 2) return;
    if (p.inCombatT > 0) {
      this.emit({ type: 'deny', x: p.x, y: p.y, why: 'em combate' });
      return;
    }
    const partner = [...this.players.values()].find((o) => o.id !== p.id);
    if (!partner) return;
    if (dist(p.x, p.y, partner.x, partner.y) > TRADE_RANGE) {
      this.emit({ type: 'deny', x: p.x, y: p.y, why: 'longe demais' });
      return;
    }
    const item = msg.kind === 'quick' ? p.inv.quick[msg.index] : p.inv.slots[msg.index];
    if (!item) return;
    const id = uid();
    this.tradeOffers.set(id, {
      id, from: p.id, to: partner.id, kind: msg.kind, index: msg.index,
      iid: item.iid, type: item.type, qty: item.qty, t: 0,
    });
    this.emit({
      type: 'trade_offer', id, from: p.id, fromName: p.name,
      to: partner.id, item: { type: item.type, qty: item.qty },
    });
  }

  invAccept(p, msg) {
    const offer = this.tradeOffers.get(msg.id);
    if (!offer || offer.to !== p.id) return;
    const giver = this.players.get(offer.from);
    if (!giver) { this.tradeOffers.delete(msg.id); return; }
    const list = offer.kind === 'quick' ? giver.inv.quick : giver.inv.slots;
    const item = list[offer.index];
    // Transação atômica: revalida o iid antes de mover.
    if (!item || item.iid !== offer.iid) {
      this.tradeOffers.delete(msg.id);
      this.emit({ type: 'deny', x: p.x, y: p.y, why: 'item mudou' });
      return;
    }
    list[offer.index] = null;
    if (!this.addItem(p, item)) {
      list[offer.index] = item; // rollback
      this.emit({ type: 'deny', x: p.x, y: p.y, why: 'inventário cheio' });
      return;
    }
    this.ledger.push({ t: this.time, action: 'trade', iid: item.iid, from: giver.id, to: p.id });
    this.tradeOffers.delete(msg.id);
    this.emit({
      type: 'trade_done', x: p.x, y: p.y, from: giver.id, to: p.id, item: item.type,
    });
  }

  invDecline(p, msg) {
    const offer = this.tradeOffers.get(msg.id);
    if (!offer || (offer.to !== p.id && offer.from !== p.id)) return;
    this.tradeOffers.delete(msg.id);
    this.emit({ type: 'trade_declined', id: msg.id });
  }

  updateTradeOffers() {
    for (const [id, o] of this.tradeOffers) {
      o.t += DT;
      if (o.t > 20) this.tradeOffers.delete(id);
    }
  }

  getOffersFor(id) {
    return [...this.tradeOffers.values()].filter((o) => o.to === id || o.from === id);
  }

  // ------------------------------------------------------------- replicação
  emit(ev) {
    this.events.push(ev);
    if (this.events.length > 80) this.events.shift();
  }

  pubPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      kit: p.kit,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      halfW: p.halfW,
      halfH: p.halfH,
      hp: p.hp,
      maxHp: p.maxHp,
      facing: p.facing,
      dashT: p.dashT,
      dashCd: p.dashCd,
      dashDirX: p.dashDirX,
      dashDirY: p.dashDirY,
      invT: p.invT,
      atkT: p.atkT,
      atkCd: p.atkCd,
      attackSeq: p.attackSeq || 0,
      blocking: p.blocking,
      downed: p.downed,
      downedT: p.downedT,
      reviveT: p.reviveT,
      dead: p.dead,
      deadT: p.deadT,
      animT: p.animT,
      moving: p.moving,
      rootedT: p.rootedT,
      markT: p.markT,
      hitFlash: p.hitFlash,
      coins: p.coins,
      lanternOn: p.lanternOn,
      reviving: p.reviving || null,
      inv: p.inv,
      ack: p.ack,
      checkpointTouch: p.checkpointTouch,
    };
  }

  pubEnemy(e) {
    return {
      id: e.id,
      type: e.type,
      x: e.x,
      y: e.y,
      hp: e.hp,
      maxHp: e.maxHp,
      state: e.state,
      stateT: e.stateT,
      facing: e.facing,
      stunT: e.stunT,
      hitFlash: e.hitFlash,
      animT: e.animT,
      weak: e.weak,
      phase: e.phase,
      tongue: e.tongue,
      lockedId: e.lockedId,
      chargeDirX: e.chargeDirX,
      chargeDirY: e.chargeDirY,
    };
  }

  buildSnapshot() {
    return {
      t: 'snap',
      tick: this.tickCount,
      time: this.time,
      roomIndex: this.roomIndex,
      room: {
        id: this.room.id,
        name: this.room.name,
        biome: this.room.biome,
        w: this.room.w,
        h: this.room.h,
        fog: !!this.room.fog,
        boss: !!this.room.boss,
      },
      players: [...this.players.values()].map((p) => this.pubPlayer(p)),
      enemies: this.enemies.filter((e) => e.hp > 0).map((e) => this.pubEnemy(e)),
      projectiles: this.projectiles.map((p) => ({
        id: p.id, type: p.type, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        dirX: p.dirX, dirY: p.dirY, radius: p.radius, fuse: p.fuse, arc: p.arc,
      })),
      items: this.items.map((i) => ({
        id: i.id, type: i.type, x: i.x, y: i.y,
        reservedBy: i.reservedBy, reserveT: i.reserveT,
      })),
      pools: this.pools.map((p) => ({ id: p.id, x: p.x, y: p.y, r: p.r, life: p.life, type: p.type })),
      world: {
        keys: this.world.keys,
        checkpoint: this.world.checkpoint,
        bossDead: this.world.bossDead,
        victory: this.world.victory,
        bossHp: this.enemies.find((e) => e.type === 'boss')?.hp ?? 0,
        bossMax: this.enemies.find((e) => e.type === 'boss')?.maxHp ?? 0,
      },
      events: this.events,
    };
  }

  roomDef() {
    const r = this.room;
    return {
      index: this.roomIndex,
      id: r.id,
      name: r.name,
      biome: r.biome,
      w: r.w,
      h: r.h,
      solids: r.solids,
      hazards: r.hazards,
      doors: r.doors,
      checkpoint: r.checkpoint,
      fog: !!r.fog,
      boss: !!r.boss,
      decorSeed: r.decorSeed,
    };
  }

  consumeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // ------------------------------------------------------------------- save
  serialize() {
    const players = {};
    for (const [id, p] of this.players) {
      players[id] = {
        name: p.name, kit: p.kit, coins: p.coins, inv: p.inv, hp: p.hp,
      };
    }
    return {
      version: 1,
      code: this.code,
      time: this.time,
      roomIndex: this.roomIndex,
      world: {
        keys: this.world.keys,
        taken: [...this.world.taken],
        checkpoint: this.world.checkpoint,
        bossDead: this.world.bossDead,
        victory: this.world.victory,
      },
      players,
      ledger: this.ledger,
    };
  }

  save() {
    try {
      const dir = path.resolve('saves');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `${this.code || 'sessao'}.json`),
        JSON.stringify(this.serialize(), null, 2),
      );
    } catch (e) {
      console.error('[save] falhou:', e.message);
    }
  }
}
