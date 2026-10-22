// Definição dos modos de jogo (tabuleiro, jogadores e posição inicial).

const WHITE = { name: 'Brancas', color: '#f5f1e8', stroke: '#2b2622' };
const BLACK = { name: 'Pretas', color: '#2b2a30', stroke: '#e8e4dc' };

export const FOUR_COLORS = [
  { name: 'Vermelho', color: '#e2504c', stroke: '#3b0f0e' },
  { name: 'Azul', color: '#4386e6', stroke: '#0e2448' },
  { name: 'Amarelo', color: '#f2c230', stroke: '#4a3500' },
  { name: 'Verde', color: '#3fae63', stroke: '#0c3b1c' },
];

function twoPlayer(id, w, h, backRank, promoTypes) {
  const pieces = [];
  for (let c = 0; c < w; c++) {
    pieces.push({ t: backRank[c], o: 1, r: 0, c });
    pieces.push({ t: 'P', o: 1, r: 1, c });
    pieces.push({ t: 'P', o: 0, r: h - 2, c });
    pieces.push({ t: backRank[c], o: 0, r: h - 1, c });
  }
  return {
    id, w, h, pieces, promoTypes,
    players: [
      { ...WHITE, forward: [-1, 0], promo: { axis: 'r', value: 0 } },
      { ...BLACK, forward: [1, 0], promo: { axis: 'r', value: h - 1 } },
    ],
  };
}

function fourPlayer({ teams = false, newPieces = false } = {}) {
  const N = 14;
  const holes = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if ((r < 3 || r > 10) && (c < 3 || c > 10)) holes.push(r * N + c);
    }
  }
  const a = newPieces ? 'RNAQKCNR' : 'RNBQKBNR';
  const b = newPieces ? 'RNCKQANR' : 'RNBKQBNR';
  const pieces = [];
  for (let i = 0; i < 8; i++) {
    pieces.push({ t: a[i], o: 0, r: 13, c: 3 + i }, { t: 'P', o: 0, r: 12, c: 3 + i });
    pieces.push({ t: a[i], o: 1, r: 10 - i, c: 0 }, { t: 'P', o: 1, r: 10 - i, c: 1 });
    pieces.push({ t: b[i], o: 2, r: 0, c: 3 + i }, { t: 'P', o: 2, r: 1, c: 3 + i });
    pieces.push({ t: b[i], o: 3, r: 10 - i, c: 13 }, { t: 'P', o: 3, r: 10 - i, c: 12 });
  }
  return {
    id: 'four', w: N, h: N, holes, pieces, teams,
    promoTypes: newPieces ? ['Q', 'C', 'A', 'R', 'N'] : ['Q', 'R', 'B', 'N'],
    players: [
      { ...FOUR_COLORS[0], forward: [-1, 0], promo: { axis: 'r', value: 6 } },
      { ...FOUR_COLORS[1], forward: [0, 1], promo: { axis: 'c', value: 7 } },
      { ...FOUR_COLORS[2], forward: [1, 0], promo: { axis: 'r', value: 7 } },
      { ...FOUR_COLORS[3], forward: [0, -1], promo: { axis: 'c', value: 6 } },
    ],
  };
}

export const VARIANTS = {
  classic: {
    name: 'Clássico',
    tag: '2 jogadores · 8×8',
    desc: 'O xadrez tradicional que todo mundo conhece.',
    seats: 2,
    build: () => twoPlayer('classic', 8, 8, 'RNBQKBNR', ['Q', 'R', 'B', 'N']),
  },
  capablanca: {
    name: 'Novas Peças',
    tag: '2 jogadores · 10×8',
    desc: 'Tabuleiro mais largo com o Arcebispo (Bispo+Cavalo) e o Chanceler (Torre+Cavalo).',
    seats: 2,
    build: () => twoPlayer('capablanca', 10, 8, 'RNABQKBCNR', ['Q', 'C', 'A', 'R', 'B', 'N']),
  },
  caos: {
    name: 'Caos',
    tag: '2 jogadores · 8×8',
    desc: 'Só peças novas: Amazona, Arcebispo, Chanceler e Camelos. Partidas explosivas!',
    seats: 2,
    build: () => twoPlayer('caos', 8, 8, 'RMAZKCMR', ['Z', 'C', 'A', 'R', 'M']),
  },
  four: {
    name: '4 Jogadores',
    tag: 'até 4 jogadores · 14×14',
    desc: 'Tabuleiro em cruz para 3 ou 4 pessoas, todos contra todos ou em equipes 2×2.',
    seats: 4,
    options: true,
    build: (opts) => fourPlayer(opts),
  },
};
