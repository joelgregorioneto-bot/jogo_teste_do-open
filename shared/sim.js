// Simulação de movimento compartilhada: roda igual no servidor e na predição
// do cliente. Qualquer mudança aqui afeta os dois lados — é proposital.

import { DASH_SPEED, DASH_TIME, DASH_IFRAMES, KITS } from './constants.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function len(x, y) {
  return Math.hypot(x, y);
}

export function norm(x, y) {
  const l = Math.hypot(x, y);
  if (l < 1e-6) return { x: 0, y: 0, l: 0 };
  return { x: x / l, y: y / l, l };
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function aabb(a, b) {
  return (
    a.x - a.halfW < b.x + b.w &&
    a.x + a.halfW > b.x &&
    a.y - a.halfH < b.y + b.h &&
    a.y + a.halfH > b.y
  );
}

export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function circleRect(cx, cy, cr, r) {
  const nx = clamp(cx, r.x, r.x + r.w);
  const ny = clamp(cy, r.y, r.y + r.h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= cr * cr;
}

function approach(value, target, delta) {
  if (value < target) return Math.min(value + delta, target);
  if (value > target) return Math.max(value - delta, target);
  return value;
}

export function moveWithCollision(p, solids, dt) {
  // Eixo X
  p.x += p.vx * dt;
  for (const s of solids) {
    if (!aabb(p, s)) continue;
    if (p.vx > 0) p.x = s.x - p.halfW;
    else if (p.vx < 0) p.x = s.x + s.w + p.halfW;
    p.vx = 0;
  }
  // Eixo Y
  p.y += p.vy * dt;
  for (const s of solids) {
    if (!aabb(p, s)) continue;
    if (p.vy > 0) p.y = s.y - p.halfH;
    else if (p.vy < 0) p.y = s.y + s.h + p.halfH;
    p.vy = 0;
  }
}

/**
 * Passo de simulação do jogador. `p` precisa ter os campos criados por
 * makePlayerState() (ver server/game.js).
 */
export function stepPlayer(p, input, solids, dt) {
  p.invT = Math.max(0, p.invT - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.atkT = Math.max(0, p.atkT - dt);
  p.atkCd = Math.max(0, p.atkCd - dt);
  p.animT += dt;
  p.moving = false;

  if (p.downed) {
    p.vx = 0;
    p.vy = 0;
    p.blocking = false;
    return;
  }

  const kit = KITS[p.kit];
  const mx = clamp(input.mx || 0, -1, 1);
  const my = clamp(input.my || 0, -1, 1);
  const dir = norm(mx, my);

  p.blocking = !!input.block && kit.canBlock && p.dashT <= 0;

  // Dash interrompe qualquer coisa (cancelamento de recovery)
  if (input.dash && p.dashCd <= 0 && p.dashT <= 0) {
    const d = dir.l > 0 ? dir : p.facing;
    p.dashDirX = d.x;
    p.dashDirY = d.y;
    p.dashT = DASH_TIME;
    p.dashCd = kit.dashCd;
    p.invT = Math.max(p.invT, DASH_IFRAMES);
  }

  if (p.dashT > 0) {
    p.dashT = Math.max(0, p.dashT - dt);
    p.vx = p.dashDirX * DASH_SPEED;
    p.vy = p.dashDirY * DASH_SPEED;
    moveWithCollision(p, solids, dt);
    p.moving = true;
    return;
  }

  if (dir.l > 0.01) {
    p.facing.x = dir.x;
    p.facing.y = dir.y;
  }

  const speedMul = p.blocking ? 0.42 : 1;
  const targetVx = dir.x * kit.speed * speedMul;
  const targetVy = dir.y * kit.speed * speedMul;
  const rate = dir.l > 0.01 ? kit.accel : kit.decel;

  p.vx = approach(p.vx, targetVx, rate * dt);
  p.vy = approach(p.vy, targetVy, rate * dt);
  p.moving = Math.abs(p.vx) + Math.abs(p.vy) > 8;

  moveWithCollision(p, solids, dt);
}

/** Separação suave entre os dois jogadores (evita empilhar). */
export function separatePlayers(a, b) {
  if (a.downed || b.downed) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = a.halfW + b.halfW - 2;
  if (d > 0.001 && d < min) {
    const push = (min - d) / 2;
    const nx = dx / d;
    const ny = dy / d;
    a.x -= nx * push;
    a.y -= ny * push;
    b.x += nx * push;
    b.y += ny * push;
  }
}

/** Util para hitboxes de ataque em arco. */
export function inArc(attacker, target, range, arc, facing) {
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const d = Math.hypot(dx, dy);
  if (d > range + (target.halfW || 0)) return false;
  if (d < 0.001) return true;
  const dot = (dx / d) * facing.x + (dy / d) * facing.y;
  return dot >= Math.cos(arc / 2);
}
