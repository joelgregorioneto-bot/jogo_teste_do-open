// Constantes compartilhadas entre servidor (autoritativo) e cliente (predição).
// Nada aqui pode depender de DOM ou de Node.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const TILE = 16;

// Resolução interna (pixel art). O canvas escala com nearest-neighbor.
export const VIEW_W = 320;
export const VIEW_H = 180;

export const DASH_SPEED = 360;
export const DASH_TIME = 0.16;
export const DASH_IFRAMES = 0.12;

export const REVIVE_TIME = 3.0;
export const DOWNED_TIME = 20.0;
export const RESPAWN_TIME = 6.0;

export const PLAYER_MAX_SLOTS = 8;
export const ITEM_PICKUP_RANGE = 22;
export const TRADE_RANGE = 220;
export const DOOR_DWELL = 0.45;

export const KITS = {
  vanguard: {
    id: 'vanguard',
    name: 'Vanguarda',
    color: '#4FC3F7',
    dark: '#1E5F7A',
    speed: 95,
    accel: 900,
    decel: 1400,
    halfW: 7,
    halfH: 8,
    maxHp: 20, // 5 corações de 4 pontos
    hearts: 5,
    attackDmg: 2,
    attackRange: 24,
    attackArc: 1.5,
    attackCd: 0.45,
    dashCd: 0.55,
    canBlock: true,
    label: 'Melee · escudo',
  },
  scout: {
    id: 'scout',
    name: 'Batedora',
    color: '#FF8A4C',
    dark: '#8A3D1E',
    speed: 130,
    accel: 1000,
    decel: 1500,
    halfW: 5.5,
    halfH: 7,
    maxHp: 12, // 3 corações
    hearts: 3,
    attackDmg: 1,
    attackRange: 0,
    attackArc: 0,
    attackCd: 0.4,
    dashCd: 0.45,
    canBlock: false,
    label: 'Distância · mobilidade',
  },
};

export const BIOMES = {
  forest: {
    name: 'Bosque Ancestral',
    enemy: 'moss',
    enemyName: 'Sentinela de Musgo',
    teaching: 'Timing de esquiva',
    palette: {
      sky0: '#0E1A13',
      sky1: '#16261C',
      far: '#1B3325',
      mid: '#24402C',
      foliage: '#2C4A33',
      leaf: '#3E7A4E',
      leafLight: '#6BBF6E',
      sun: '#F2E6A8',
      sunLight: '#FFF6C9',
      ground: '#5A4632',
      groundTop: '#8A6B4A',
      water: '#2E6B7A',
      waterLight: '#58A8B8',
      accent: '#FFB03A',
    },
  },
  cave: {
    name: 'Grutas de Ametista',
    enemy: 'eye',
    enemyName: 'Olho de Cristal',
    teaching: 'Cobertura e posicionamento',
    palette: {
      sky0: '#0B0813',
      sky1: '#14101F',
      far: '#1C1429',
      mid: '#241A38',
      foliage: '#3A2E52',
      leaf: '#57477A',
      leafLight: '#8A5CFF',
      sun: '#C7A8FF',
      sunLight: '#E8DFFF',
      ground: '#2A2038',
      groundTop: '#4A3A63',
      water: '#2E6B7A',
      waterLight: '#59E0E0',
      accent: '#59E0E0',
    },
  },
  desert: {
    name: 'Dunas Rubras',
    enemy: 'beetle',
    enemyName: 'Escaravelho Couraça',
    teaching: 'Esquiva lateral e punição',
    palette: {
      sky0: '#B4683A',
      sky1: '#E0894F',
      far: '#C98A50',
      mid: '#D9A05B',
      foliage: '#B87A3E',
      leaf: '#A67C52',
      leafLight: '#FFF0C2',
      sun: '#F2C078',
      sunLight: '#FFF6D6',
      ground: '#8C5A2E',
      groundTop: '#D9A05B',
      water: '#7FD1C7',
      waterLight: '#B8F0EA',
      accent: '#FFD166',
    },
  },
  swamp: {
    name: 'Pântano das Brumas',
    enemy: 'toad',
    enemyName: 'Sapo Bubônico',
    teaching: 'Gerenciamento de área',
    palette: {
      sky0: '#0C1511',
      sky1: '#16221C',
      far: '#1A2A20',
      mid: '#21362B',
      foliage: '#2F4A32',
      leaf: '#4C6B3A',
      leafLight: '#6E8F4A',
      sun: '#D6E3CC',
      sunLight: '#E4FF6B',
      ground: '#2A3A30',
      groundTop: '#4C6B3A',
      water: '#3B5A4A',
      waterLight: '#9BF6A3',
      accent: '#C77DFF',
    },
  },
};

export const ITEM_DEFS = {
  coin: { name: 'Moeda', icon: 'coin', stack: 99, auto: true },
  potion: { name: 'Poção', icon: 'potion', stack: 9, heal: 8, use: true },
  bomb: { name: 'Bomba', icon: 'bomb', stack: 5, tool: true },
  grapple: { name: 'Gancho', icon: 'grapple', stack: 1, tool: true },
  lantern: { name: 'Lanterna', icon: 'lantern', stack: 1, tool: true },
  key_big: { name: 'Chave Grande', icon: 'key', stack: 1, shared: true },
};

export const CHARACTERS = {
  vanguard: {
    moveSpeed: 95,
    drawH: 26,
    drawW: 18,
  },
  scout: {
    moveSpeed: 130,
    drawH: 24,
    drawW: 12,
  },
};

export const NET = {
  INPUT_HZ: 60,
  MAX_INPUT_QUEUE: 16,
  INTERP_DELAY: 0.1,
  MAX_SEPARATION: 260,
  MIN_SEPARATION: 120,
  CAM_ZOOM_MIN: 0.72,
  CAM_ZOOM_MAX: 1,
};
