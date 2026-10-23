// Interface DOM: lobby, inventários, ofertas de troca, avisos e ajuda.

import { ITEM_DEFS, KITS } from '/shared/constants.js';

const ICONS = {
  coin: '●',
  potion: '⚗',
  bomb: '✹',
  grapple: '✦',
  lantern: '▣',
  key_big: '⚿',
};

export class UI {
  constructor(handlers = {}) {
    this.h = handlers;
    this.invOpen = false;
    this.helpOpen = false;
    this.selected = null;
    this.lastSnap = null;
    this.lastRender = 0;
    this.kit = 'vanguard';
    this.offers = new Map();

    this.lobby = document.getElementById('lobby');
    this.invEl = document.getElementById('inventory');
    this.helpEl = document.getElementById('help');
    this.toasts = document.getElementById('toasts');
    this.tradeEl = document.getElementById('tradeOffers');
    this.msg = document.getElementById('lobbyMsg');
    this.nameInput = document.getElementById('nameInput');
    this.codeInput = document.getElementById('codeInput');
    this.playBtn = document.getElementById('playBtn');
    this.disconnected = document.getElementById('disconnected');

    this.nameInput.value = localStorage.getItem('aventura_nome') || '';
    this.codeInput.value = new URLSearchParams(location.search).get('sala') || 'AMIGOS';

    for (const btn of document.querySelectorAll('.kit')) {
      btn.addEventListener('click', () => {
        this.kit = btn.dataset.kit;
        for (const b of document.querySelectorAll('.kit')) b.classList.toggle('active', b === btn);
      });
    }
    document.querySelector('.kit[data-kit="vanguard"]')?.classList.add('active');

    this.playBtn.addEventListener('click', () => {
      const name = (this.nameInput.value || 'Jogador').trim().slice(0, 14);
      const code = (this.codeInput.value || 'AMIGOS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'AMIGOS';
      localStorage.setItem('aventura_nome', name);
      this.h.onJoin?.({ name, code, kit: this.kit });
    });

    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.playBtn.click();
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.playBtn.click();
    });

    document.getElementById('closeInv')?.addEventListener('click', () => this.toggleInventory(false));
    document.getElementById('closeHelp')?.addEventListener('click', () => this.toggleHelp(false));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.invOpen) this.toggleInventory(false);
        if (this.helpOpen) this.toggleHelp(false);
      }
    });

    this.invEl.addEventListener('click', (e) => {
      const slot = e.target.closest('[data-slot]');
      if (slot) {
        const kind = slot.dataset.kind;
        const index = Number(slot.dataset.slot);
        if (slot.dataset.owner === 'you') {
          this.selected = { kind, index };
          this.renderInventory();
        }
        return;
      }
      const action = e.target.closest('[data-action]');
      if (!action || !this.selected) return;
      const { action: a } = action.dataset;
      if (a === 'cancel') {
        this.selected = null;
        this.renderInventory();
        return;
      }
      this.h.onInvAction?.({ a, kind: this.selected.kind, index: this.selected.index });
      if (a === 'drop' || a === 'offer') this.selected = null;
      this.renderInventory();
    });
  }

  bindJoin(cb) {
    this.h.onJoin = cb;
  }

  setLobbyMessage(text) {
    this.msg.textContent = text || '';
  }

  hideLobby() {
    this.lobby.classList.add('hidden');
  }

  showLobby() {
    this.lobby.classList.remove('hidden');
  }

  setDisconnected(on) {
    this.disconnected.classList.toggle('hidden', !on);
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 320);
    }, 2600);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  toggleInventory(force) {
    this.invOpen = force === undefined ? !this.invOpen : force;
    this.invEl.classList.toggle('hidden', !this.invOpen);
    if (this.invOpen) this.renderInventory();
  }

  toggleHelp(force) {
    this.helpOpen = force === undefined ? !this.helpOpen : force;
    this.helpEl.classList.toggle('hidden', !this.helpOpen);
  }

  setSnapshot(snap, myId) {
    this.lastSnap = snap;
    this.myId = myId;
    if (this.invOpen) this.renderInventory();
  }

  itemButtonLabel(type) {
    return ITEM_DEFS[type]?.name || type;
  }

  slotHtml(item, kind, index, owner, keyHint) {
    const filled = item ? 'filled' : '';
    const sel = this.selected && this.selected.kind === kind && this.selected.index === index && owner === 'you' ? 'selected' : '';
    const icon = item ? ICONS[item.type] || '?' : '';
    const qty = item && item.qty > 1 ? `<span class="qty">${item.qty}</span>` : '';
    const label = keyHint ? `<span class="label">${keyHint}</span>` : '';
    return `<div class="slot ${filled} ${sel}" data-owner="${owner}" data-kind="${kind}" data-slot="${index}" title="${item ? this.itemButtonLabel(item.type) : ''}">
      ${label}${icon}${qty}
    </div>`;
  }

  renderInventory() {
    const snap = this.lastSnap;
    if (!snap) return;
    const me = snap.players.find((p) => p.id === this.myId);
    const partner = snap.players.find((p) => p.id !== this.myId);
    if (!me) return;

    const you = document.getElementById('invYou');
    const other = document.getElementById('invPartner');
    const kitMe = KITS[me.kit];
    const kitOther = partner ? KITS[partner.kit] : null;

    let html = `<h3>${me.name} — ${kitMe?.name || me.kit}</h3>`;
    html += '<div class="slot-grid">';
    for (let i = 0; i < 8; i++) html += this.slotHtml(me.inv.slots[i], 'slots', i, 'you');
    html += '</div>';
    html += '<div class="quick-row">';
    for (let i = 0; i < 2; i++) html += this.slotHtml(me.inv.quick[i], 'quick', i, 'you', i + 1);
    html += this.slotHtml(me.inv.tool, 'tool', 0, 'you', '⚙');
    html += '</div>';
    html += `<div class="coins">● ${me.coins} moedas · ⚿ ${snap.world.keys} chave(s) compartilhada(s)</div>`;

    if (this.selected) {
      const list = this.selected.kind === 'quick' ? me.inv.quick
        : this.selected.kind === 'tool' ? [me.inv.tool]
          : me.inv.slots;
      const item = list[this.selected.index];
      if (item) {
        const def = ITEM_DEFS[item.type] || {};
        html += `<div class="item-actions"><b>${def.name || item.type}</b>`;
        if (def.heal) html += '<button data-action="use">Usar</button>';
        if (def.tool && this.selected.kind !== 'tool') html += '<button data-action="use">Equipar</button>';
        if (partner) html += '<button data-action="offer">Dar ao parceiro</button>';
        html += '<button data-action="drop" class="ghost danger">Dropar</button>';
        html += '<button data-action="cancel" class="ghost">×</button></div>';
      }
    } else {
      html += '<div class="item-actions"><span style="color:#7e9aa6">Clique em um item para ações</span></div>';
    }
    you.innerHTML = html;
    you.className = 'inv-col you';

    if (partner) {
      let ph = `<h3>${partner.name} — ${kitOther?.name || partner.kit}</h3>`;
      ph += '<div class="slot-grid">';
      for (let i = 0; i < 8; i++) ph += this.slotHtml(partner.inv.slots[i], 'slots', i, 'partner');
      ph += '</div><div class="quick-row">';
      for (let i = 0; i < 2; i++) ph += this.slotHtml(partner.inv.quick[i], 'quick', i, 'partner');
      ph += this.slotHtml(partner.inv.tool, 'tool', 0, 'partner', '⚙');
      ph += '</div>';
      ph += `<div class="coins">● ${partner.coins} moedas</div>`;
      other.innerHTML = ph;
      other.className = 'inv-col partner';
    } else {
      other.innerHTML = '<h3>Parceiro</h3><p class="hint">Aguardando conexão…</p>';
      other.className = 'inv-col partner offline';
    }
    this.lastRender = performance.now();
  }

  addTradeOffer(ev) {
    if (this.offers.has(ev.id)) return;
    const card = document.createElement('div');
    card.className = 'trade';
    const name = ITEM_DEFS[ev.item.type]?.name || ev.item.type;
    card.innerHTML = `
      <div><b>${ev.fromName}</b> quer te dar <b>${name}</b>${ev.item.qty > 1 ? ` ×${ev.item.qty}` : ''}</div>
      <div style="display:flex;gap:6px">
        <button data-accept="${ev.id}">Aceitar</button>
        <button class="decline" data-decline="${ev.id}">Recusar</button>
      </div>`;
    card.querySelector('[data-accept]').addEventListener('click', () => {
      this.h.onInvAction?.({ a: 'accept', id: ev.id });
      this.removeTradeOffer(ev.id);
    });
    card.querySelector('[data-decline]').addEventListener('click', () => {
      this.h.onInvAction?.({ a: 'decline', id: ev.id });
      this.removeTradeOffer(ev.id);
    });
    this.tradeEl.appendChild(card);
    this.offers.set(ev.id, card);
    setTimeout(() => this.removeTradeOffer(ev.id), 20_000);
  }

  removeTradeOffer(id) {
    const card = this.offers.get(id);
    if (card) card.remove();
    this.offers.delete(id);
  }

  showVictory() {
    const el = document.createElement('div');
    el.className = 'panel';
    el.style.zIndex = 50;
    el.innerHTML = `
      <h1 style="color:#9bf6a3">VITÓRIA</h1>
      <p class="sub">O Coração do Pântano foi silenciado.</p>
      <p class="hint">Os dois heróis sobreviveram aos quatro biomas.<br/>
      Pressione <b>F5</b> para recomeçar a aventura.</p>`;
    document.getElementById('stage').appendChild(el);
  }
}
