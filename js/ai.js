// Computador simples: busca alfa-beta curta em partidas de 2 jogadores e
// heurística gulosa (ganho de material sem deixar peças penduradas) com 3–4.
import { legalMoves, makeMove, isAttacked, PIECE_TYPES } from './engine.js';

const value = t => (t === 'K' ? 50 : PIECE_TYPES[t].value);

function evaluate(s, p) {
  if (s.status === 'over') {
    if (s.result.type === 'draw') return 0;
    return s.result.winners.includes(p) ? 1e5 : -1e5;
  }
  if (!s.alive[p]) return -1e5;
  const mat = s.players.map(() => 0);
  const cr = (s.h - 1) / 2, cc = (s.w - 1) / 2;
  for (let r = 0; r < s.h; r++) {
    for (let c = 0; c < s.w; c++) {
      const pc = s.board[r][c];
      if (!pc) continue;
      const center = pc.t === 'K' ? 0 : 0.08 * (1 - (Math.abs(r - cr) + Math.abs(c - cc)) / (cr + cc));
      mat[pc.o] += value(pc.t) + center;
    }
  }
  let mine = 0, theirs = 0, n = 0;
  for (const o of s.participants) {
    if (o === p || (s.teams && o % 2 === p % 2)) mine += mat[o];
    else if (s.alive[o]) { theirs += mat[o]; n++; }
  }
  return mine - (s.teams || n <= 1 ? theirs : theirs / n * 1.5);
}

function ordered(moves) {
  return moves
    .map(m => ({ m, k: (m.cap ? value(m.cap.t) * 10 : 0) + (m.promo ? value(m.promo) : 0) }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.m);
}

function search(s, depth, alpha, beta, root) {
  if (depth === 0 || s.status === 'over') return evaluate(s, root);
  const maximizing = s.turn === root;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of ordered(legalMoves(s))) {
    const v = search(makeMove(s, m), depth - 1, alpha, beta, root);
    if (maximizing) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
    else { best = Math.min(best, v); beta = Math.min(beta, v); }
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseMove(s) {
  const p = s.turn;
  const moves = ordered(legalMoves(s));
  if (!moves.length) return null;
  const twoSided = s.participants.filter(o => s.alive[o]).length === 2 && !s.teams;
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const after = makeMove(s, m);
    let score;
    if (twoSided) {
      score = search(after, 2, -Infinity, Infinity, p);
    } else {
      score = evaluate(after, p);
      const moved = after.board[m.tr][m.tc];
      if (moved && after.status === 'playing' && isAttacked(after, m.tr, m.tc, p)) score -= value(moved.t) * 0.85;
    }
    score += Math.random() * 0.25;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
