// Tabuleiro 2D em HTML/CSS. Suporta rotação para deixar qualquer jogador embaixo.
import { PIECE_TYPES } from './engine.js';

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟', A: '♝', C: '♜', Z: '♛', M: '♞' };
const BADGE = { A: '♞', C: '♞', Z: '♞', M: '3' };

export function pieceHTML(t, player, extraClass = '') {
  const badge = BADGE[t] ? `<i class="badge">${BADGE[t]}︎</i>` : '';
  return `<span class="pc pc-${t} ${extraClass}" title="${PIECE_TYPES[t].name}" style="--pc:${player.color};--st:${player.stroke}">${GLYPH[t]}︎${badge}</span>`;
}

// Converte coordenadas do tabuleiro em coordenadas de exibição para a rotação dada.
function toDisplay(s, r, c, rot) {
  switch (rot) {
    case 1: return [s.w - 1 - c, r];
    case 2: return [s.h - 1 - r, s.w - 1 - c];
    case 3: return [c, s.h - 1 - r];
    default: return [r, c];
  }
}

const key = (r, c) => `${r},${c}`;

export class Board2D {
  constructor(host, onSquareClick) {
    this.el = document.createElement('div');
    this.el.className = 'board2d';
    host.appendChild(this.el);
    this.el.addEventListener('click', e => {
      const cell = e.target.closest('.cell[data-r]');
      if (cell) onSquareClick(+cell.dataset.r, +cell.dataset.c);
    });
  }

  render(s, ui = {}) {
    const rot = (s.w !== s.h ? (ui.rot || 0) & 2 : ui.rot || 0) % 4;
    const cols = rot % 2 ? s.h : s.w;
    const rows = rot % 2 ? s.w : s.h;
    this.el.style.setProperty('--cols', cols);
    this.el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.el.style.aspectRatio = `${cols} / ${rows}`;

    const targets = new Map((ui.targets || []).map(m => [key(m.tr, m.tc), m]));
    const checks = new Set((ui.checks || []).map(k => key(k.r, k.c)));
    const stars = ui.stars || new Set();
    const lm = ui.lastMove;
    let html = '';
    for (let r = 0; r < s.h; r++) {
      for (let c = 0; c < s.w; c++) {
        const [dr, dc] = toDisplay(s, r, c, rot);
        const pos = `grid-row:${dr + 1};grid-column:${dc + 1}`;
        if (s.holes.has(r * s.w + c)) { html += `<div class="cell hole" style="${pos}"></div>`; continue; }
        const k = key(r, c);
        const cls = ['cell', (r + c) % 2 ? 'dark' : 'light'];
        if (ui.selected && ui.selected.r === r && ui.selected.c === c) cls.push('sel');
        if (lm && ((lm.fr === r && lm.fc === c) || (lm.tr === r && lm.tc === c))) cls.push('last');
        if (checks.has(k)) cls.push('check');
        const pc = s.board[r][c];
        if (targets.has(k)) cls.push(pc || targets.get(k).ep ? 'capture' : 'target');
        let inner = '';
        if (dr === rows - 1) inner += `<b class="coord f">${'abcdefghijklmnop'[c]}</b>`;
        if (dc === 0) inner += `<b class="coord r">${s.h - r}</b>`;
        if (stars.has(k)) inner += '<span class="star">★</span>';
        if (pc) inner += pieceHTML(pc.t, s.players[pc.o]);
        html += `<div class="${cls.join(' ')}" data-r="${r}" data-c="${c}" style="${pos}">${inner}</div>`;
      }
    }
    this.el.innerHTML = html;
  }

  dispose() { this.el.remove(); }
}
