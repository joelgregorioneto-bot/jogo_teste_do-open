// Mapa do mundo: 8 salas, 4 biomas, progressão por ferramentas.
// Coordenadas em pixels. Grade de 16px, sala de 40x22 tiles.

import { TILE, BIOMES } from '../shared/constants.js';

const T = (n) => n * TILE;
const W = 40;
const H = 22;

function border() {
  return [
    { x: 0, y: 0, w: T(W), h: T(1) },
    { x: 0, y: T(H - 1), w: T(W), h: T(1) },
    { x: 0, y: 0, w: T(1), h: T(H) },
    { x: T(W - 1), y: 0, w: T(1), h: T(H) },
  ];
}

function wall(tx, ty, tw, th, extra = {}) {
  return { x: T(tx), y: T(ty), w: T(tw), h: T(th), ...extra };
}

function mk(def) {
  const d = {
    ...def,
    w: T(W),
    h: T(H),
    solids: [...border(), ...(def.solids || [])],
    hazards: def.hazards || [],
    items: def.items || [],
    spawns: def.spawns || [],
    doors: def.doors || [],
    checkpoint: def.checkpoint || null,
    decorSeed: def.id.length * 7919 + def.id.charCodeAt(0) * 131,
    biomeName: BIOMES[def.biome].name,
  };
  return d;
}

export const ROOMS = [
  // ---------------------------------------------------------------- BOSQUE 1
  mk({
    id: 'forest_1',
    index: 0,
    biome: 'forest',
    name: 'Clareira de Entrada',
    start: { x: T(4), y: T(11) },
    solids: [
      wall(9, 3, 3, 2),
      wall(17, 7, 4, 1),
      wall(25, 2, 2, 3),
      wall(30, 12, 3, 2),
      wall(7, 14, 2, 2),
      wall(22, 15, 1, 3),
      wall(14, 17, 3, 1),
      wall(34, 5, 2, 2),
    ],
    spawns: [
      { type: 'moss', x: T(15), y: T(9) },
      { type: 'moss', x: T(27), y: T(18) },
    ],
    items: [
      { type: 'coin', x: T(10), y: T(9) },
      { type: 'coin', x: T(26), y: T(6) },
      { type: 'potion', x: T(33), y: T(18) },
    ],
    doors: [
      { x: T(37), y: T(9), w: T(3), h: T(4), to: 1, entry: { x: T(3), y: T(11) } },
    ],
  }),

  // ---------------------------------------------------------------- BOSQUE 2
  mk({
    id: 'forest_2',
    index: 1,
    biome: 'forest',
    name: 'Bosque dos Ecos',
    start: { x: T(4), y: T(11) },
    solids: [
      wall(6, 3, 2, 3),
      wall(14, 16, 3, 2),
      wall(24, 3, 3, 2),
      wall(30, 15, 2, 3),
      wall(20, 10, 1, 5),
      wall(9, 10, 2, 1),
    ],
    spawns: [
      { type: 'moss', x: T(25), y: T(9) },
      { type: 'moss', x: T(12), y: T(14) },
    ],
    checkpoint: { x: T(5), y: T(18) },
    items: [
      { type: 'bomb', x: T(20), y: T(6) }, // ferramenta: quebra parede rachada
      { type: 'potion', x: T(34), y: T(6) },
    ],
    doors: [
      { x: T(37), y: T(15), w: T(3), h: T(4), to: 2, entry: { x: T(3), y: T(17) } },
    ],
  }),

  // ------------------------------------------------------------------ GRUTA 1
  mk({
    id: 'cave_1',
    index: 2,
    biome: 'cave',
    name: 'Galeria Rachada',
    start: { x: T(3), y: T(17) },
    solids: [
      wall(19, 6, 1, 14, { breakable: 'bomb' }),
      wall(7, 8, 3, 2),
      wall(12, 13, 2, 2),
      wall(27, 4, 3, 3),
      wall(27, 14, 3, 2),
      wall(33, 9, 2, 2),
      wall(7, 16, 4, 2),
    ],
    spawns: [
      { type: 'eye', x: T(14), y: T(4) },
      { type: 'eye', x: T(29), y: T(18) },
    ],
    items: [
      { type: 'coin', x: T(4), y: T(4) },
      { type: 'potion', x: T(31), y: T(7) },
      { type: 'coin', x: T(24), y: T(18) },
    ],
    doors: [
      { x: T(37), y: T(8), w: T(3), h: T(4), to: 3, entry: { x: T(3), y: T(10) } },
    ],
  }),

  // ------------------------------------------------------------------ GRUTA 2
  mk({
    id: 'cave_2',
    index: 3,
    biome: 'cave',
    name: 'Santuário de Ametista',
    start: { x: T(3), y: T(17) },
    solids: [
      wall(6, 5, 3, 3),
      wall(13, 3, 2, 2),
      wall(20, 9, 3, 2),
      wall(28, 5, 4, 3),
      wall(32, 14, 2, 3),
      wall(10, 16, 3, 2),
      wall(24, 16, 2, 2),
    ],
    spawns: [
      { type: 'eye', x: T(22), y: T(4) },
      { type: 'eye', x: T(15), y: T(18) },
    ],
    checkpoint: { x: T(5), y: T(19) },
    items: [
      { type: 'grapple', x: T(35), y: T(4) },
      { type: 'potion', x: T(17), y: T(6) },
    ],
    doors: [
      { x: T(37), y: T(15), w: T(3), h: T(4), to: 4, entry: { x: T(3), y: T(17) } },
    ],
  }),

  // ------------------------------------------------------------------ DUNAS 1
  mk({
    id: 'dunes_1',
    index: 4,
    biome: 'desert',
    name: 'Mar de Vidro',
    start: { x: T(3), y: T(10) },
    solids: [
      wall(6, 3, 4, 3),
      wall(15, 9, 3, 3),
      wall(26, 3, 3, 3),
      wall(32, 12, 3, 3),
      wall(11, 16, 4, 2),
      wall(35, 4, 2, 2),
    ],
    hazards: [
      { type: 'pit', x: T(21), y: T(8), w: T(7), h: T(7) },
    ],
    spawns: [
      { type: 'beetle', x: T(12), y: T(6) },
      { type: 'beetle', x: T(33), y: T(18) },
    ],
    items: [
      { type: 'coin', x: T(8), y: T(18) },
      { type: 'potion', x: T(29), y: T(7) },
      { type: 'coin', x: T(24), y: T(17) },
    ],
    doors: [
      { x: T(37), y: T(9), w: T(3), h: T(4), to: 5, entry: { x: T(3), y: T(11) } },
    ],
  }),

  // ------------------------------------------------------------------ DUNAS 2
  mk({
    id: 'dunes_2',
    index: 5,
    biome: 'desert',
    name: 'Ruínas do Sol Alto',
    start: { x: T(3), y: T(17) },
    solids: [
      wall(7, 4, 3, 2),
      wall(15, 6, 2, 2),
      wall(23, 12, 4, 2),
      wall(31, 4, 2, 2),
      wall(33, 15, 2, 3),
      wall(12, 15, 2, 2),
      wall(19, 2, 2, 2),
    ],
    spawns: [
      { type: 'beetle', x: T(20), y: T(9) },
      { type: 'beetle', x: T(28), y: T(18) },
    ],
    checkpoint: { x: T(4), y: T(19) },
    items: [
      { type: 'lantern', x: T(28), y: T(8) },
      { type: 'potion', x: T(36), y: T(8) },
    ],
    doors: [
      { x: T(37), y: T(15), w: T(3), h: T(4), to: 6, entry: { x: T(3), y: T(17) } },
    ],
  }),

  // ----------------------------------------------------------------- PÂNTANO 1
  mk({
    id: 'swamp_1',
    index: 6,
    biome: 'swamp',
    name: 'Vale Nebuloso',
    fog: true,
    start: { x: T(3), y: T(10) },
    solids: [
      wall(6, 3, 2, 3),
      wall(12, 12, 3, 2),
      wall(20, 2, 2, 4),
      wall(27, 12, 3, 3),
      wall(33, 6, 2, 3),
      wall(9, 17, 3, 2),
      wall(30, 17, 3, 2),
      wall(23, 6, 2, 2),
    ],
    hazards: [
      { type: 'poison', x: T(16), y: T(14), w: T(4), h: T(3) },
      { type: 'poison', x: T(23), y: T(8), w: T(3), h: T(2) },
    ],
    spawns: [
      { type: 'toad', x: T(18), y: T(5) },
      { type: 'toad', x: T(29), y: T(9) },
    ],
    items: [
      { type: 'key_big', x: T(35), y: T(18) },
      { type: 'potion', x: T(5), y: T(7) },
    ],
    doors: [
      {
        x: T(37), y: T(9), w: T(3), h: T(4), to: 7, entry: { x: T(3), y: T(11) },
        needs: 'key_big', label: 'Portão do Coração',
      },
    ],
  }),

  // -------------------------------------------------------------- CHEFE FINAL
  mk({
    id: 'swamp_boss',
    index: 7,
    biome: 'swamp',
    name: 'Coração do Pântano',
    fog: true,
    boss: true,
    start: { x: T(4), y: T(18) },
    solids: [
      wall(9, 3, 2, 2),
      wall(29, 3, 2, 2),
      wall(9, 17, 2, 2),
      wall(29, 17, 2, 2),
      wall(14, 8, 2, 1),
      wall(24, 8, 2, 1),
    ],
    spawns: [{ type: 'boss', x: T(20), y: T(6) }],
    checkpoint: { x: T(4), y: T(19) },
    items: [],
    doors: [],
  }),
];

export function getRoom(index) {
  return ROOMS[Math.max(0, Math.min(ROOMS.length - 1, index))];
}

/** Posição segura mais próxima para queda em abismo. */
export function safeSpot(room, x, y) {
  const candidates = [
    room.start,
    ...room.doors.map((d) => d.entry),
    ...(room.checkpoint ? [room.checkpoint] : []),
  ];
  let best = room.start;
  let bd = Infinity;
  for (const c of candidates) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return { x: best.x, y: best.y };
}
