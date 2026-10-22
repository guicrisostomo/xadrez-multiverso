// Tutorial interativo (lições com estrelas para coletar, capturas e xeque-mate)
// e a página de referência das peças.
import { createState, legalMoves, makeMove, isInCheck, PIECE_TYPES } from './engine.js';
import { VARIANTS } from './variants.js';
import { Board2D, pieceHTML } from './render2d.js';
import { $, store, showModal, closeModal } from './ui.js';

const PROGRESS_KEY = 'xadrez.tutorial.v1';

const sq = name => ({ r: 8 - Number(name.slice(1)), c: name.charCodeAt(0) - 97 });
const W = (t, at) => ({ t, o: 0, ...sq(at) });
const B = (t, at) => ({ t, o: 1, ...sq(at) });

const LESSONS = [
  { title: 'Bem-vindo!', kind: 'info', variant: 'classic',
    text: `<p>O xadrez é jogado em um tabuleiro de casas claras e escuras. Cada jogador comanda um exército e o objetivo é dar <strong>xeque-mate</strong> no rei adversário: atacá-lo de forma que ele não consiga escapar.</p>
      <p>Neste site você pode jogar o xadrez clássico, variantes com <strong>peças novas</strong> e partidas com <strong>até 4 jogadores</strong>, tanto em <strong>2D</strong> quanto em <strong>3D</strong>.</p>
      <p>Nas próximas lições você aprende a mover cada peça. Clique em uma peça para ver para onde ela pode ir e clique no destino para movê-la.</p>` },
  { title: 'A Torre', pieces: [W('R', 'a1')], stars: ['a5', 'e5', 'e8'],
    text: '<p>A <strong>Torre</strong> anda em linha reta, na horizontal ou na vertical, quantas casas quiser.</p><p>🎯 Colete todas as estrelas.</p>' },
  { title: 'O Bispo', pieces: [W('B', 'c1')], stars: ['e3', 'g5', 'd8'],
    text: '<p>O <strong>Bispo</strong> anda na diagonal, quantas casas quiser. Ele fica sempre na mesma cor de casa.</p><p>🎯 Colete todas as estrelas.</p>' },
  { title: 'A Dama', pieces: [W('Q', 'd1'), B('P', 'd6'), B('P', 'h5'), B('P', 'a4')], goal: 'captureAll',
    text: '<p>A <strong>Dama</strong> é a peça mais forte do xadrez clássico: anda como a Torre e como o Bispo juntos.</p><p>Para capturar, basta mover sua peça para a casa ocupada por uma peça adversária.</p><p>🎯 Capture todos os peões pretos.</p>' },
  { title: 'O Rei', pieces: [W('K', 'e1')], stars: ['d2', 'e3', 'f3'],
    text: '<p>O <strong>Rei</strong> anda apenas uma casa em qualquer direção. Ele é a peça mais importante: se for encurralado, você perde!</p><p>🎯 Colete as estrelas.</p>' },
  { title: 'O Cavalo', pieces: [W('N', 'b1')], stars: ['c3', 'd5', 'f6'],
    text: '<p>O <strong>Cavalo</strong> se move em "L": duas casas em uma direção e uma para o lado. É a única peça clássica que <strong>pula</strong> outras peças.</p><p>🎯 Colete as estrelas.</p>' },
  { title: 'O Peão', pieces: [W('P', 'e2'), B('P', 'e5'), B('N', 'd5')], stars: ['d8'],
    text: '<p>O <strong>Peão</strong> avança uma casa para frente (ou duas no primeiro lance), mas <strong>captura na diagonal</strong>.</p><p>Quando chega ao outro lado do tabuleiro ele é <strong>promovido</strong> e vira outra peça.</p><p>🎯 Leve o peão até a estrela (dica: o peão preto bloqueia o caminho, capture o cavalo!).</p>' },
  { title: 'O Roque', pieces: [W('K', 'e1'), W('R', 'h1'), W('R', 'a1'), W('P', 'f2'), W('P', 'g2'), W('P', 'h2')], stars: ['g1'], maxMoves: 1,
    text: '<p>O <strong>Roque</strong> é um lance especial que protege o rei: o rei anda duas casas em direção a uma torre e a torre pula para o outro lado dele.</p><p>Só é permitido se rei e torre nunca se moveram, não há peças entre eles e o rei não está em xeque nem passa por casas atacadas.</p><p>🎯 Faça o roque em <strong>um lance</strong>: clique no rei e depois na estrela.</p>' },
  { title: 'Xeque-mate', pieces: [W('K', 'g1'), W('R', 'a1'), W('P', 'f2'), W('P', 'g2'), W('P', 'h2'), B('K', 'g8'), B('P', 'f7'), B('P', 'g7'), B('P', 'h7')], goal: 'mate', maxMoves: 1,
    text: '<p>Quando o rei é atacado ele está em <strong>xeque</strong> e precisa escapar. Se não houver como escapar, é <strong>xeque-mate</strong> e a partida acaba.</p><p>🎯 Dê xeque-mate em um lance. Repare que os próprios peões prendem o rei preto…</p>' },
  { title: 'Nova peça: Arcebispo', pieces: [W('A', 'd4')], stars: ['f5', 'c8', 'a7'],
    text: '<p>O <strong>Arcebispo</strong> combina o <strong>Bispo</strong> e o <strong>Cavalo</strong>: anda na diagonal ou salta em "L".</p><p>🎯 Colete as estrelas.</p>' },
  { title: 'Nova peça: Chanceler', pieces: [W('C', 'a1')], stars: ['a6', 'c7', 'h7'],
    text: '<p>O <strong>Chanceler</strong> combina a <strong>Torre</strong> e o <strong>Cavalo</strong>: anda em linha reta ou salta em "L".</p><p>🎯 Colete as estrelas.</p>' },
  { title: 'Nova peça: Amazona', pieces: [W('Z', 'd1'), B('P', 'e3'), B('P', 'h6'), B('P', 'b5'), B('N', 'g8')], goal: 'captureAll',
    text: '<p>A <strong>Amazona</strong> combina a <strong>Dama</strong> e o <strong>Cavalo</strong>. É a peça mais poderosa do site!</p><p>🎯 Capture todas as peças pretas.</p>' },
  { title: 'Nova peça: Camelo', pieces: [W('M', 'd4')], stars: ['e7', 'h6', 'g3'],
    text: '<p>O <strong>Camelo</strong> salta em um "L" comprido: <strong>três</strong> casas em uma direção e uma para o lado, pulando outras peças.</p><p>🎯 Colete as estrelas.</p>' },
  { title: 'Xadrez para 4 jogadores', kind: 'info', variant: 'four',
    text: `<p>No modo <strong>4 Jogadores</strong> o tabuleiro tem forma de cruz (14×14). A ordem é Vermelho → Azul → Amarelo → Verde.</p>
      <ul><li>Quem leva xeque-mate (ou fica sem lances) é <strong>eliminado</strong> e suas peças saem do tabuleiro.</li>
      <li>Se um rei ficar em xeque e outro jogador puder capturá-lo antes da vez do dono, o rei é capturado!</li>
      <li>Os peões são promovidos ao chegar na <strong>linha central</strong> (8ª fileira de cada jogador).</li>
      <li>No modo <strong>equipes</strong>, Vermelho + Amarelo jogam contra Azul + Verde.</li>
      <li>Dá para jogar com <strong>2, 3 ou 4</strong> pessoas (opção "Jogadores na mesa"); com 2, elas ficam frente a frente. Também dá para completar a mesa com o computador.</li>
      <li>O modo <strong>Multiverso</strong> usa este mesmo tabuleiro só com as peças novas: Amazona, Arcebispo, Chanceler e Camelo.</li></ul>` },
  { title: 'Pronto para jogar!', kind: 'info', variant: 'capablanca',
    text: `<p>Parabéns, você concluiu o tutorial! 🎉</p>
      <p>Crie uma <strong>conta</strong> (botão "Entrar" no topo) para suas partidas valerem no <strong>ranking global</strong> (sistema Elo, começando em 1200).</p>
      <p><a class="btn" href="#jogar">Começar uma partida</a></p>` },
];

function lessonState(lesson) {
  if (lesson.kind === 'info') return createState(VARIANTS[lesson.variant].build({}));
  const base = VARIANTS.classic.build();
  return createState({ ...base, id: 'tutorial', pieces: lesson.pieces });
}

let t = null;

export function initTutorial() {
  t = { index: 0, board: new Board2D($('#tutorial-board'), onSquare) };
  $('#tut-prev').addEventListener('click', () => load(t.index - 1));
  $('#tut-next').addEventListener('click', () => load(t.index + 1));
  $('#tut-reset').addEventListener('click', () => load(t.index));
  load(0);
}

function progress() { return store.get(PROGRESS_KEY, []); }

function renderList() {
  const done = new Set(progress());
  $('#lesson-list').innerHTML = LESSONS.map((l, i) =>
    `<li><button class="${i === t.index ? 'active' : ''}" data-i="${i}">${done.has(i) ? '✅' : `${i + 1}.`} ${l.title}</button></li>`).join('');
  $('#lesson-list').querySelectorAll('button').forEach(b => b.addEventListener('click', () => load(+b.dataset.i)));
}

function load(i) {
  if (i < 0 || i >= LESSONS.length) return;
  const lesson = LESSONS[i];
  Object.assign(t, { index: i, lesson, state: lessonState(lesson), stars: new Set((lesson.stars || []).map(n => { const p = sq(n); return `${p.r},${p.c}`; })), moves: 0, selected: null, done: lesson.kind === 'info' });
  if (t.done) markDone();
  $('#lesson-title').textContent = `${i + 1}. ${lesson.title}`;
  $('#lesson-text').innerHTML = lesson.text;
  setFeedback('');
  $('#tut-prev').disabled = i === 0;
  $('#tut-next').disabled = i === LESSONS.length - 1;
  $('#tut-reset').hidden = lesson.kind === 'info';
  $('#tutorial-board').dataset.size = lesson.variant === 'four' ? 'big' : '';
  renderList();
  draw();
}

function draw() {
  const targets = t.selected ? legalMoves(t.state, 0).filter(m => m.fr === t.selected.r && m.fc === t.selected.c) : [];
  t.board.render(t.state, { selected: t.selected, targets, stars: t.stars, lastMove: t.state.lastMove });
}

function setFeedback(html, cls = '') {
  const el = $('#lesson-feedback');
  el.innerHTML = html;
  el.className = `feedback ${cls}`;
}

function markDone() {
  const done = new Set(progress());
  done.add(t.index);
  store.set(PROGRESS_KEY, [...done]);
}

function onSquare(r, c) {
  if (t.done || t.lesson.kind === 'info') return;
  const s = t.state;
  if (t.selected) {
    const options = legalMoves(s, 0).filter(m => m.fr === t.selected.r && m.fc === t.selected.c && m.tr === r && m.tc === c);
    if (options.length) {
      const move = options.find(m => m.promo === 'Q') || options[0];
      return apply(move);
    }
  }
  const pc = s.board[r][c];
  t.selected = pc && pc.o === 0 && !(t.selected && t.selected.r === r && t.selected.c === c) ? { r, c } : null;
  draw();
}

function apply(move) {
  t.state = makeMove(t.state, move, { advance: false });
  t.state.turn = 0;
  t.selected = null;
  t.moves++;
  t.stars.delete(`${move.tr},${move.tc}`);
  const l = t.lesson;
  let success = false;
  if (l.goal === 'captureAll') success = !t.state.board.some(row => row.some(p => p && p.o === 1));
  else if (l.goal === 'mate') {
    const them = { ...t.state, turn: 1 };
    success = isInCheck(them, 1) && legalMoves(them, 1).length === 0;
  } else success = t.stars.size === 0;
  draw();
  if (success) {
    t.done = true;
    markDone();
    renderList();
    setFeedback(`Muito bem! ${t.index < LESSONS.length - 1 ? '<button class="btn small" id="tut-go">Próxima lição →</button>' : ''}`, 'ok');
    $('#tut-go')?.addEventListener('click', () => load(t.index + 1));
  } else if (l.maxMoves && t.moves >= l.maxMoves) {
    setFeedback('Não foi dessa vez. Tente de novo!', 'bad');
    setTimeout(() => t.lesson === l && load(t.index), 1300);
  }
}

// ---------------------------------------------------------------- página das peças

export function initPieces() {
  const order = ['K', 'Q', 'R', 'B', 'N', 'P', 'A', 'C', 'Z', 'M'];
  const host = $('#pieces-grid');
  const base = VARIANTS.classic.build();
  for (const type of order) {
    const def = PIECE_TYPES[type];
    const card = document.createElement('article');
    card.className = `piece-card ${def.isNew ? 'new' : ''}`;
    card.innerHTML = `
      <div class="mini-board"></div>
      <div class="pc-info">
        <h3>${pieceHTML(type, base.players[0], 'mini')} ${def.name} ${def.isNew ? '<span class="new-tag">nova</span>' : ''}</h3>
        <p>${def.desc}</p>
        <p class="value">Valor aproximado: ${type === 'K' ? '∞' : def.value}</p>
      </div>`;
    host.appendChild(card);
    const s = createState({ ...base, id: 'pieces', w: 7, h: 7, pieces: [{ t: type, o: 0, r: type === 'P' ? 5 : 3, c: 3 }], castling: false });
    const targets = legalMoves(s, 0);
    new Board2D(card.querySelector('.mini-board'), () => {}).render(s, { targets });
  }
}

export function maybeOfferTutorial() {
  if (store.get('xadrez.welcomed', false)) return;
  store.set('xadrez.welcomed', true);
  const card = showModal(`
    <h2>♞ Bem-vindo ao Xadrez Multiverso!</h2>
    <p>Primeira vez por aqui? O tutorial inicial ensina como cada peça se move, incluindo as peças novas e o modo para 4 jogadores. Leva só alguns minutos.</p>
    <div class="actions">
      <button class="btn" data-a="tut">Fazer o tutorial</button>
      <button class="btn ghost" data-a="skip">Pular e jogar</button>
    </div>`);
  card.addEventListener('click', e => {
    const a = e.target.dataset.a;
    if (!a) return;
    closeModal();
    location.hash = a === 'tut' ? '#tutorial' : '#jogar';
  });
}
