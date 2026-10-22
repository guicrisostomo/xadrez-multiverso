import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, legalMoves, makeMove, resign, isInCheck } from '../js/engine.js';
import { VARIANTS } from '../js/variants.js';

const sq = (s, name) => ({ r: s.h - Number(name.slice(1)), c: name.charCodeAt(0) - 97 });
function play(s, ...moves) {
  for (const mv of moves) {
    const [a, b] = mv.split('-');
    const f = sq(s, a), t = sq(s, b);
    const m = legalMoves(s).find(x => x.fr === f.r && x.fc === f.c && x.tr === t.r && x.tc === t.c && (!x.promo || x.promo === 'Q'));
    assert.ok(m, `lance ilegal: ${mv}`);
    s = makeMove(s, m);
  }
  return s;
}
function perft(s, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) n += d === 1 ? 1 : perft(makeMove(s, m), d - 1);
  return n;
}

test('perft do xadrez clássico', () => {
  const s = createState(VARIANTS.classic.build());
  assert.equal(perft(s, 1), 20);
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
});

test('lances iniciais das outras variantes', () => {
  assert.equal(legalMoves(createState(VARIANTS.capablanca.build())).length, 28);
  const four = createState(VARIANTS.four.build({}));
  assert.equal(legalMoves(four).length, 20);
  assert.ok(legalMoves(createState(VARIANTS.caos.build())).length > 16);
});

test('mate do pastor encerra a partida', () => {
  let s = createState(VARIANTS.classic.build());
  s = play(s, 'e2-e4', 'e7-e5', 'f1-c4', 'b8-c6', 'd1-h5', 'g8-f6', 'h5-f7');
  assert.equal(s.status, 'over');
  assert.deepEqual(s.result.winners, [0]);
  assert.equal(s.log.filter(e => !e.sys).at(-1).suffix, '#');
});

test('roque e en passant', () => {
  let s = createState(VARIANTS.classic.build());
  s = play(s, 'e2-e4', 'a7-a6', 'g1-f3', 'a6-a5', 'f1-c4', 'a5-a4', 'e1-g1');
  assert.equal(s.board[7][5].t, 'R');
  assert.equal(s.board[7][6].t, 'K');
  s = play(s, 'b7-b5', 'e4-e5', 'd7-d5', 'e5-d6');
  assert.equal(s.board[3][3], null, 'peão capturado en passant');
});

test('4 jogadores: desistências até restar um', () => {
  let s = createState(VARIANTS.four.build({}));
  s = resign(s); s = resign(s); s = resign(s);
  assert.equal(s.status, 'over');
  assert.deepEqual(s.result.winners, [3]);
  assert.equal(s.result.rank[2], 2);
});

test('4 jogadores em equipes', () => {
  let s = createState(VARIANTS.four.build({ teams: true }));
  s = resign(s); // vermelho
  assert.equal(s.status, 'playing');
  s = resign(s); // azul
  s = resign(s); // amarelo -> equipe azul/verde vence
  assert.equal(s.status, 'over');
  assert.deepEqual(s.result.winners, [1, 3]);
});

test('3 jogadores (assento vazio)', () => {
  const s = createState(VARIANTS.four.build({}), [true, true, false, true]);
  assert.equal(s.board[0][3], null);
  let t = makeMove(s, legalMoves(s)[0]);
  t = makeMove(t, legalMoves(t)[0]);
  assert.equal(t.turn, 3);
  assert.equal(isInCheck(t, 3), false);
});
