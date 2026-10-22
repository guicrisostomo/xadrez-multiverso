// Motor de regras genérico: tabuleiros de qualquer tamanho (inclusive com casas
// removidas), de 2 a 4 jogadores, modo equipes e peças novas (de "fadas").

export const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
export const CAMEL = [[-3, -1], [-3, 1], [-1, -3], [-1, 3], [1, -3], [1, 3], [3, -1], [3, 1]];
const ALL8 = [...ORTH, ...DIAG];

export const PIECE_TYPES = {
  K: { name: 'Rei', value: 0, slides: [], leaps: ALL8,
    desc: 'Move-se uma casa em qualquer direção. Se levar xeque-mate (ou for capturado no modo 4 jogadores), o jogador está fora.' },
  Q: { name: 'Dama', value: 9, slides: ALL8, leaps: [],
    desc: 'Desliza quantas casas quiser em linha reta ou na diagonal.' },
  R: { name: 'Torre', value: 5, slides: ORTH, leaps: [],
    desc: 'Desliza quantas casas quiser na horizontal ou na vertical.' },
  B: { name: 'Bispo', value: 3.2, slides: DIAG, leaps: [],
    desc: 'Desliza quantas casas quiser na diagonal.' },
  N: { name: 'Cavalo', value: 3, slides: [], leaps: KNIGHT,
    desc: 'Salta em "L" (2 casas + 1 casa) e pode pular outras peças.' },
  P: { name: 'Peão', value: 1, slides: [], leaps: [],
    desc: 'Avança uma casa (ou duas no primeiro lance) e captura na diagonal. Ao chegar na linha de promoção vira outra peça.' },
  A: { name: 'Arcebispo', value: 7, slides: DIAG, leaps: KNIGHT, isNew: true,
    desc: 'Peça nova: combina Bispo + Cavalo.' },
  C: { name: 'Chanceler', value: 8.5, slides: ORTH, leaps: KNIGHT, isNew: true,
    desc: 'Peça nova: combina Torre + Cavalo.' },
  Z: { name: 'Amazona', value: 12, slides: ALL8, leaps: KNIGHT, isNew: true,
    desc: 'Peça nova: combina Dama + Cavalo. A peça mais poderosa do jogo!' },
  M: { name: 'Camelo', value: 2.5, slides: [], leaps: CAMEL, isNew: true,
    desc: 'Peça nova: salta em um "L" alongado (3 casas + 1 casa), pulando outras peças.' },
};

const ORTH_SLIDERS = new Set(['R', 'Q', 'C', 'Z']);
const DIAG_SLIDERS = new Set(['B', 'Q', 'A', 'Z']);
const KNIGHT_LEAPERS = new Set(['N', 'A', 'C', 'Z']);
const CAMEL_LEAPERS = new Set(['M']);
const MINOR = new Set(['N', 'B', 'M']);

// ---------------------------------------------------------------- criação

export function createState(setup, active = setup.players.map(() => true)) {
  const board = Array.from({ length: setup.h }, () => Array(setup.w).fill(null));
  for (const p of setup.pieces) if (active[p.o]) board[p.r][p.c] = { t: p.t, o: p.o, m: false };
  const participants = setup.players.map((_, i) => i).filter(i => active[i]);
  return {
    variantId: setup.id,
    w: setup.w,
    h: setup.h,
    holes: new Set(setup.holes || []),
    players: setup.players,
    teams: !!setup.teams,
    promoTypes: setup.promoTypes || ['Q', 'R', 'B', 'N'],
    castling: setup.castling !== false,
    board,
    turn: participants[0],
    alive: active.slice(),
    participants,
    ep: null,
    halfmove: 0,
    ply: 0,
    lastMove: null,
    log: [],
    eliminated: [],
    status: 'playing',
    result: null,
  };
}

export function cloneState(s) {
  return {
    ...s,
    board: s.board.map(row => row.slice()),
    alive: s.alive.slice(),
    eliminated: s.eliminated.slice(),
    log: s.log.slice(),
  };
}

// ---------------------------------------------------------------- utilidades

export function onBoard(s, r, c) {
  return r >= 0 && r < s.h && c >= 0 && c < s.w && !s.holes.has(r * s.w + c);
}

export function isEnemy(s, a, b) {
  if (a === b || a < 0 || b < 0) return false;
  if (s.teams) return a % 2 !== b % 2;
  return true;
}

export function pawnCaptureDirs(player) {
  const [fr, fc] = player.forward;
  return fr !== 0 ? [[fr, -1], [fr, 1]] : [[-1, fc], [1, fc]];
}

export function isPromotionSquare(player, r, c) {
  return player.promo.axis === 'r' ? r === player.promo.value : c === player.promo.value;
}

export function squareName(s, r, c) {
  return 'abcdefghijklmnop'[c] + (s.h - r);
}

export function findKing(s, p) {
  for (let r = 0; r < s.h; r++) {
    for (let c = 0; c < s.w; c++) {
      const pc = s.board[r][c];
      if (pc && pc.o === p && pc.t === 'K') return { r, c };
    }
  }
  return null;
}

// A casa (r, c) está atacada por algum adversário do jogador p?
export function isAttacked(s, r, c, p) {
  const b = s.board;
  for (const [dirs, sliders] of [[ORTH, ORTH_SLIDERS], [DIAG, DIAG_SLIDERS]]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc, d = 1;
      while (onBoard(s, rr, cc)) {
        const pc = b[rr][cc];
        if (pc) {
          if (isEnemy(s, p, pc.o) && (sliders.has(pc.t) || (d === 1 && pc.t === 'K'))) return true;
          break;
        }
        rr += dr; cc += dc; d++;
      }
    }
  }
  for (const [offsets, leapers] of [[KNIGHT, KNIGHT_LEAPERS], [CAMEL, CAMEL_LEAPERS]]) {
    for (const [dr, dc] of offsets) {
      const rr = r + dr, cc = c + dc;
      if (!onBoard(s, rr, cc)) continue;
      const pc = b[rr][cc];
      if (pc && leapers.has(pc.t) && isEnemy(s, p, pc.o)) return true;
    }
  }
  for (let o = 0; o < s.players.length; o++) {
    if (!s.alive[o] || !isEnemy(s, p, o)) continue;
    for (const [dr, dc] of pawnCaptureDirs(s.players[o])) {
      const rr = r - dr, cc = c - dc;
      if (!onBoard(s, rr, cc)) continue;
      const pc = b[rr][cc];
      if (pc && pc.o === o && pc.t === 'P') return true;
    }
  }
  return false;
}

export function isInCheck(s, p) {
  const k = findKing(s, p);
  return k ? isAttacked(s, k.r, k.c, p) : false;
}

// ---------------------------------------------------------------- geração de lances

function pseudoMoves(s, p) {
  const moves = [];
  const b = s.board;
  const pl = s.players[p];
  const canLand = (r, c) => onBoard(s, r, c) && (!b[r][c] || isEnemy(s, p, b[r][c].o));

  for (let r = 0; r < s.h; r++) {
    for (let c = 0; c < s.w; c++) {
      const pc = b[r][c];
      if (!pc || pc.o !== p) continue;

      if (pc.t === 'P') {
        const pushPawn = (tr, tc, extra) => {
          if (isPromotionSquare(pl, tr, tc)) {
            for (const t of s.promoTypes) moves.push({ fr: r, fc: c, tr, tc, ...extra, promo: t });
          } else {
            moves.push({ fr: r, fc: c, tr, tc, ...extra });
          }
        };
        const [f0, f1] = pl.forward;
        const r1 = r + f0, c1 = c + f1;
        if (onBoard(s, r1, c1) && !b[r1][c1]) {
          pushPawn(r1, c1, { cap: null });
          const r2 = r1 + f0, c2 = c1 + f1;
          if (!pc.m && onBoard(s, r2, c2) && !b[r2][c2] && !isPromotionSquare(pl, r1, c1)) {
            pushPawn(r2, c2, { cap: null, dbl: { r: r1, c: c1 } });
          }
        }
        for (const [dr, dc] of pawnCaptureDirs(pl)) {
          const tr = r + dr, tc = c + dc;
          if (!onBoard(s, tr, tc)) continue;
          const target = b[tr][tc];
          if (target) {
            if (isEnemy(s, p, target.o)) pushPawn(tr, tc, { cap: target });
          } else if (s.ep && s.ep.r === tr && s.ep.c === tc && isEnemy(s, p, s.ep.o)) {
            const victim = b[s.ep.pr][s.ep.pc];
            if (victim) pushPawn(tr, tc, { cap: victim, ep: { r: s.ep.pr, c: s.ep.pc } });
          }
        }
        continue;
      }

      const def = PIECE_TYPES[pc.t];
      for (const [dr, dc] of def.slides) {
        let tr = r + dr, tc = c + dc;
        while (onBoard(s, tr, tc)) {
          const target = b[tr][tc];
          if (target) {
            if (isEnemy(s, p, target.o)) moves.push({ fr: r, fc: c, tr, tc, cap: target });
            break;
          }
          moves.push({ fr: r, fc: c, tr, tc, cap: null });
          tr += dr; tc += dc;
        }
      }
      for (const [dr, dc] of def.leaps) {
        const tr = r + dr, tc = c + dc;
        if (canLand(tr, tc)) moves.push({ fr: r, fc: c, tr, tc, cap: b[tr][tc] });
      }

      if (pc.t === 'K' && !pc.m && s.castling && !isAttacked(s, r, c, p)) {
        const lateral = pl.forward[0] !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
        for (const [dr, dc] of lateral) {
          let rr = r + dr, cc = c + dc, d = 1;
          while (onBoard(s, rr, cc) && !b[rr][cc]) { rr += dr; cc += dc; d++; }
          if (!onBoard(s, rr, cc) || d < 3) continue;
          const rook = b[rr][cc];
          if (!rook || rook.o !== p || rook.t !== 'R' || rook.m) continue;
          const mr = r + dr, mc = c + dc, kr = r + 2 * dr, kc = c + 2 * dc;
          if (isAttacked(s, mr, mc, p) || isAttacked(s, kr, kc, p)) continue;
          moves.push({ fr: r, fc: c, tr: kr, tc: kc, cap: null, castle: { fr: rr, fc: cc, tr: mr, tc: mc } });
        }
      }
    }
  }
  return moves;
}

function applyToBoard(board, m) {
  const b = board.map(row => row.slice());
  const pc = b[m.fr][m.fc];
  b[m.fr][m.fc] = null;
  if (m.ep) b[m.ep.r][m.ep.c] = null;
  b[m.tr][m.tc] = { t: m.promo || pc.t, o: pc.o, m: true };
  if (m.castle) {
    const rook = b[m.castle.fr][m.castle.fc];
    b[m.castle.fr][m.castle.fc] = null;
    b[m.castle.tr][m.castle.tc] = { ...rook, m: true };
  }
  return b;
}

function leavesKingSafe(s, m, p) {
  const after = { ...s, board: applyToBoard(s.board, m) };
  const king = s.board[m.fr][m.fc].t === 'K' ? { r: m.tr, c: m.tc } : findKing(after, p);
  return !king || !isAttacked(after, king.r, king.c, p);
}

export function legalMoves(s, p = s.turn) {
  if (s.status !== 'playing' || !s.alive[p]) return [];
  return pseudoMoves(s, p).filter(m => leavesKingSafe(s, m, p));
}

// ---------------------------------------------------------------- aplicar lances

function eliminate(s, p, reason) {
  if (!s.alive[p]) return;
  s.alive[p] = false;
  s.eliminated.push(p);
  s.board = s.board.map(row => row.map(pc => (pc && pc.o === p ? null : pc)));
  if (s.ep && s.ep.o === p) s.ep = null;
  s.log.push({ sys: true, p, text: `${s.players[p].name} foi eliminado (${reason})` });
}

function finish(s, type, winners, reason) {
  s.status = 'over';
  const rank = {};
  if (type === 'draw') {
    for (const p of s.participants) rank[p] = 1;
  } else if (s.teams) {
    for (const p of s.participants) rank[p] = winners.includes(p) ? 1 : 2;
  } else {
    for (const p of winners) rank[p] = 1;
    // Quem foi eliminado por último fica em melhor posição.
    let place = winners.length + 1;
    for (let i = s.eliminated.length - 1; i >= 0; i--) {
      if (rank[s.eliminated[i]] == null) rank[s.eliminated[i]] = place++;
    }
  }
  s.result = { type, winners, reason, rank };
  s.log.push({ sys: true, text: type === 'draw'
    ? `Empate (${reason})`
    : `Vitória: ${winners.map(w => s.players[w].name).join(' e ')} (${reason})` });
}

function checkGameOver(s) {
  const alive = s.participants.filter(p => s.alive[p]);
  if (s.teams) {
    const teams = new Set(alive.map(p => p % 2));
    if (teams.size <= 1) {
      const team = alive.length ? alive[0] % 2 : -1;
      finish(s, 'win', s.participants.filter(p => p % 2 === team), s.lastReason || 'equipe adversária eliminada');
      return true;
    }
  } else if (alive.length <= 1) {
    finish(s, 'win', alive, s.lastReason || 'último sobrevivente');
    return true;
  }
  if (alive.length === 2 && !s.teams) {
    if (s.halfmove >= 100) { finish(s, 'draw', [], 'regra dos 50 lances'); return true; }
    const rest = [];
    for (const row of s.board) for (const pc of row) if (pc && pc.t !== 'K') rest.push(pc.t);
    if (rest.length === 0 || (rest.length === 1 && MINOR.has(rest[0]))) {
      finish(s, 'draw', [], 'material insuficiente');
      return true;
    }
  }
  return false;
}

function nextAlive(s, from) {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const p = (from + i) % n;
    if (s.alive[p]) return p;
  }
  return from;
}

function advanceTurn(s) {
  for (let guard = 0; guard < s.players.length + 1; guard++) {
    if (checkGameOver(s)) return;
    s.turn = nextAlive(s, s.turn);
    if (pseudoMoves(s, s.turn).some(m => leavesKingSafe(s, m, s.turn))) return;
    const inCheck = isInCheck(s, s.turn);
    const aliveCount = s.participants.filter(p => s.alive[p]).length;
    if (!inCheck && aliveCount === 2) { finish(s, 'draw', [], 'afogamento'); return; }
    s.lastReason = inCheck ? 'xeque-mate' : 'afogamento';
    eliminate(s, s.turn, inCheck ? 'xeque-mate' : 'afogado');
  }
}

export function makeMove(state, m, { advance = true } = {}) {
  const s = cloneState(state);
  const mover = s.board[m.fr][m.fc];
  s.lastReason = null;
  s.board = applyToBoard(s.board, m);
  s.ep = m.dbl ? { r: m.dbl.r, c: m.dbl.c, pr: m.tr, pc: m.tc, o: mover.o } : null;
  s.halfmove = mover.t === 'P' || m.cap ? 0 : s.halfmove + 1;
  s.ply++;
  s.lastMove = { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc, p: mover.o };
  const entry = {
    p: mover.o, t: mover.t, cap: m.cap ? m.cap.t : null, promo: m.promo || null,
    castle: !!m.castle,
    from: squareName(s, m.fr, m.fc), to: squareName(s, m.tr, m.tc), suffix: '',
  };
  s.log.push(entry);
  if (m.cap && m.cap.t === 'K') {
    s.lastReason = 'rei capturado';
    eliminate(s, m.cap.o, 'rei capturado');
  }
  if (advance) {
    const before = s.eliminated.length;
    advanceTurn(s);
    if (s.eliminated.length > before || (s.status === 'over' && s.result.type === 'win')) entry.suffix = '#';
    else if (s.status === 'playing' && s.participants.some(p => s.alive[p] && isInCheck(s, p))) entry.suffix = '+';
  }
  return s;
}

export function resign(state) {
  const s = cloneState(state);
  s.lastReason = 'desistência';
  eliminate(s, s.turn, 'desistiu');
  s.ep = null;
  advanceTurn(s);
  return s;
}

export function sameMove(a, b) {
  return a.fr === b.fr && a.fc === b.fc && a.tr === b.tr && a.tc === b.tc && (a.promo || null) === (b.promo || null);
}
