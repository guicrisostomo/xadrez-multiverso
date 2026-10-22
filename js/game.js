// Tela de configuração e controle da partida (jogadores locais e computador).
import { createState, legalMoves, makeMove, resign, isInCheck, findKing, sameMove, PIECE_TYPES } from './engine.js';
import { VARIANTS, CROSS_SEATS } from './variants.js';
import { chooseMove } from './ai.js';
import { Board2D, pieceHTML } from './render2d.js';
import { recordLocal, reportMatch } from './ranking.js';
import { currentUser, onAuthChange, openLogin } from './auth.js';
import { supabaseEnabled } from './supabase.js';
import { $, $$, store, escapeHTML, showModal, closeModal, toast, confirmDialog } from './ui.js';

const SETUP_KEY = 'xadrez.setup.v1';
const ROT_OF = { '-1,0': 0, '0,1': 1, '1,0': 2, '0,-1': 3 };

let ctx = null;

// ---------------------------------------------------------------- configuração

export function initSetup() {
  const saved = store.get(SETUP_KEY, {});
  const form = $('#setup-form');
  $('#variant-list').innerHTML = Object.entries(VARIANTS).map(([id, v]) => `
    <label class="variant-card">
      <input type="radio" name="variant" value="${id}" ${id === (saved.variant || 'classic') ? 'checked' : ''}>
      <span class="vc-body">
        <span class="vc-tag">${v.tag}</span>
        <strong>${v.name}</strong>
        <span class="vc-desc">${v.desc}</span>
      </span>
    </label>`).join('');
  form.teams.checked = !!saved.teams;
  form.newPieces.checked = !!saved.newPieces;
  form.mode.value = saved.mode || '2d';

  // Lê os assentos como estão no formulário (para preservar o que o usuário digitou).
  const readSeats = () => $$('#seat-list .seat').map((_, i) => ({
    name: form[`seatName${i}`].value, type: form[`seatType${i}`].value,
  }));

  const renderSeats = (current = null) => {
    const v = VARIANTS[form.variant.value];
    const setup = v.build({});
    const user = currentUser();
    $('#four-options').hidden = !v.options;
    $('#opt-teams').hidden = !v.options?.teams;
    $('#opt-new-pieces').hidden = !v.options?.newPieces;
    $('#seat-count-row').hidden = v.seats <= 2;
    const prev = current || store.get(SETUP_KEY, {}).seats || [];
    let accountUsed = false;
    $('#seat-list').innerHTML = setup.players.map((p, i) => {
      const s = prev[i] || {};
      let type = s.type || (i === 0 || v.seats === 2 ? 'human' : 'bot');
      if (type === 'empty' && v.seats <= 2) type = 'human';
      if (type === 'account' && (!user || accountUsed)) type = 'human';
      if (user && i === 0 && !current && !prev.some(x => x?.type === 'account')) type = 'account';
      if (type === 'account') accountUsed = true;
      const name = type === 'account' ? user.username : (s.type === 'account' ? '' : s.name) || `Jogador ${i + 1}`;
      return `
      <div class="seat">
        <span class="dot" style="--pc:${p.color};--st:${p.stroke}"></span>
        <span class="seat-color">${p.name}</span>
        <input name="seatName${i}" maxlength="20" value="${escapeHTML(name)}" aria-label="Nome do jogador ${i + 1}" ${type === 'account' ? 'readonly' : ''}>
        <select name="seatType${i}" aria-label="Tipo do jogador ${i + 1}">
          ${user ? `<option value="account" ${type === 'account' ? 'selected' : ''}>Você (conta)</option>` : ''}
          <option value="human" ${type === 'human' ? 'selected' : ''}>Humano</option>
          <option value="bot" ${type === 'bot' ? 'selected' : ''}>Computador</option>
          ${v.seats > 2 ? `<option value="empty" ${type === 'empty' ? 'selected' : ''}>Vazio</option>` : ''}
        </select>
      </div>`;
    }).join('');
    syncSeatCount();
    renderRatedHint();
  };

  // Seletor "Jogadores na mesa" do tabuleiro em cruz: ocupa os assentos certos
  // (com 2 jogadores eles ficam frente a frente).
  const syncSeatCount = () => {
    const active = readSeats().filter(s => s.type !== 'empty').length;
    form.seatCount.value = CROSS_SEATS[active] ? String(active) : '';
  };
  const applySeatCount = n => {
    const seats = readSeats();
    const want = CROSS_SEATS[n];
    seats.forEach((s, i) => {
      if (!want.includes(i)) s.type = 'empty';
      else if (s.type === 'empty') s.type = 'bot';
    });
    if (n < 4) form.teams.checked = false;
    renderSeats(seats);
  };

  const renderRatedHint = () => {
    const hint = $('#rated-hint');
    if (!supabaseEnabled()) { hint.hidden = true; return; }
    hint.hidden = false;
    const seats = readSeats().filter(s => s.type !== 'empty');
    const humans = seats.filter(s => s.type !== 'bot');
    if (!currentUser()) {
      hint.innerHTML = '🔒 <a href="#" data-login>Entre na sua conta</a> para esta partida valer no ranking global.';
      hint.querySelector('[data-login]').addEventListener('click', e => { e.preventDefault(); openLogin(); });
    } else if (seats.some(s => s.type === 'account') && humans.length === 1) {
      hint.textContent = '🏆 Esta partida vale para o ranking global.';
    } else {
      hint.textContent = 'ℹ️ No mesmo aparelho, só valem para o ranking global partidas entre você (conta) e o computador. Para jogar com amigos valendo ranking, use uma sala online.';
    }
  };

  form.addEventListener('change', e => {
    if (e.target.name === 'variant') renderSeats();
    else if (e.target.name === 'seatCount' && e.target.value) applySeatCount(+e.target.value);
    else if (e.target.name?.startsWith('seatType')) {
      const seats = readSeats();
      const i = +e.target.name.slice(8);
      if (e.target.value === 'account') seats.forEach((s, j) => { if (j !== i && s.type === 'account') s.type = 'human'; });
      if (seats[i].type !== 'account' && form[`seatName${i}`].readOnly) seats[i].name = `Jogador ${i + 1}`;
      renderSeats(seats);
    } else if (e.target.name === 'teams' && e.target.checked) applySeatCount(4);
  });
  onAuthChange(user => {
    const seats = readSeats();
    // Ao entrar na conta, o primeiro assento humano passa a ser o da conta.
    const first = seats.findIndex(x => x.type === 'human');
    if (user && first >= 0 && !seats.some(x => x.type === 'account')) seats[first].type = 'account';
    renderSeats(seats);
  });
  renderSeats();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const variant = form.variant.value;
    const n = VARIANTS[variant].build({}).players.length;
    const user = currentUser();
    const options = VARIANTS[variant].options || {};
    const seats = Array.from({ length: n }, (_, i) => {
      const type = form[`seatType${i}`].value;
      if (type === 'account' && user) return { name: user.username, type: 'human', account: true, userId: user.id };
      return { name: form[`seatName${i}`].value.trim() || `Jogador ${i + 1}`, type: type === 'account' ? 'human' : type };
    });
    const config = {
      variant, seats, mode: form.mode.value,
      teams: !!options.teams && form.teams.checked,
      newPieces: !!options.newPieces && form.newPieces.checked,
    };
    const active = seats.filter(s => s.type !== 'empty');
    if (active.length < 2) return toast('São necessários pelo menos 2 jogadores.', 'warn');
    if (config.teams && active.length < 4) return toast('O modo equipes precisa dos 4 assentos ocupados.', 'warn');
    const humans = active.filter(s => s.type === 'human').map(s => s.name.toLowerCase());
    if (new Set(humans).size !== humans.length) return toast('Use nomes diferentes para cada jogador humano (o ranking usa o nome).', 'warn');
    store.set(SETUP_KEY, { ...config, seats: seats.map(s => ({ name: s.name, type: s.account ? 'account' : s.type })) });
    startGame(config);
  });
}

// ---------------------------------------------------------------- partida

// net: conexão da sala online (ou null para jogo local). moves: lances já jogados,
// usados para reconstruir a partida de quem entra ou reconecta no meio do jogo.
// Tipos de assento: human (joga neste aparelho), remote (outro aparelho), bot, empty.
export function startGame(config, net = null, moves = []) {
  stopGame();
  // Cada partida local tem seu próprio id (usado ao registrar no ranking).
  if (!net) config = { ...config, gameId: crypto.randomUUID() };
  const v = VARIANTS[config.variant];
  const setup = v.build({ teams: config.teams, newPieces: config.newPieces });
  const active = config.seats.map(s => s.type !== 'empty');
  const state = createState(setup, active);
  ctx = {
    config, net, state, history: [], moves: [], selected: null, rot: 0, recorded: false, renderer: null,
    variantName: v.name + (config.teams ? ' (equipes)' : ''),
  };
  for (const ser of moves) applySer(ser);
  ctx.recorded = ctx.state.status === 'over';
  location.hash = '#partida';
  setMode(config.mode || '2d');
  maybeBot();
}

export function stopGame() {
  if (!ctx) return;
  clearTimeout(ctx.botTimer);
  ctx.renderer?.dispose();
  ctx = null;
}

export function hasGame() { return !!ctx; }

export function currentGame() {
  return ctx ? { gameId: ctx.config.gameId, moves: ctx.moves.slice(), state: ctx.state, config: ctx.config } : null;
}

// Lance vindo de outro jogador da sala.
export function receiveMove({ gameId, seq, move }) {
  if (!ctx || !ctx.net || ctx.config.gameId !== gameId) return;
  if (seq < ctx.moves.length) return;
  if (seq > ctx.moves.length) { ctx.net.requestSync(); return; }
  if (!commit(move, false)) ctx.net.requestSync();
}

// Troca o tipo de um assento (ex.: jogador desconectado passa para o computador).
export function setSeatType(gameId, p, type) {
  if (!ctx || ctx.config.gameId !== gameId || !ctx.config.seats[p]) return;
  ctx.config.seats[p] = { ...ctx.config.seats[p], type };
  refresh();
  maybeBot();
}

async function setMode(mode) {
  const host = $('#board-host');
  ctx.renderer?.dispose();
  ctx.renderer = null;
  host.innerHTML = '';
  host.dataset.mode = mode;
  ctx.mode = mode;
  if (mode === '3d') {
    host.innerHTML = '<div class="loading">Carregando 3D…</div>';
    try {
      const { Board3D } = await import('./render3d.js');
      if (!ctx || ctx.mode !== '3d') return;
      host.innerHTML = '';
      ctx.renderer = new Board3D(host, onSquare);
    } catch (err) {
      console.error(err);
      toast('Não foi possível carregar o modo 3D. Usando 2D.', 'error');
      return setMode('2d');
    }
  } else {
    ctx.renderer = new Board2D(host, onSquare);
  }
  $('#btn-mode').textContent = mode === '3d' ? 'Ver em 2D' : 'Ver em 3D';
  refresh();
}

const seatOf = p => ctx.config.seats[p];
const runsBots = () => !ctx.net || ctx.net.isHost;
const isHumanTurn = () => ctx.state.status === 'playing' && seatOf(ctx.state.turn).type === 'human';

function viewPlayer() {
  const { state, config } = ctx;
  const humans = state.participants.filter(p => config.seats[p].type === 'human');
  if ($('#opt-autorotate').checked && humans.includes(state.turn)) return state.turn;
  if ($('#opt-autorotate').checked && humans.length > 1 && ctx.lastHuman != null) return ctx.lastHuman;
  return humans[0] ?? state.participants[0];
}

function refresh() {
  if (!ctx || !ctx.renderer) return;
  const s = ctx.state;
  if (isHumanTurn()) ctx.lastHuman = s.turn;
  const vp = viewPlayer();
  const pl = s.players[vp];
  const baseRot = ROT_OF[pl.forward.join(',')];
  const checks = s.participants.filter(p => s.alive[p] && isInCheck(s, p)).map(p => findKing(s, p));
  const targets = ctx.selected && $('#opt-hints').checked
    ? legalMoves(s).filter(m => m.fr === ctx.selected.r && m.fc === ctx.selected.c) : [];
  ctx.renderer.render(s, {
    selected: ctx.selected, targets, checks, lastMove: s.lastMove,
    rot: ctx.mode === '3d' ? ctx.rot : (baseRot + ctx.rot) % 4,
    viewPlayer: vp,
  });
  renderSide();
}

function renderSide() {
  const s = ctx.state;
  const banner = $('#turn-banner');
  if (s.status === 'over') {
    banner.innerHTML = s.result.type === 'draw' ? 'Empate!' : `🏆 ${s.result.winners.map(w => escapeHTML(seatOf(w).name)).join(' e ')} venceu!`;
  } else {
    const p = s.players[s.turn];
    const seat = seatOf(s.turn);
    const note = seat.type === 'bot' ? ' <em>(pensando…)</em>' : seat.type === 'remote' ? ' <em>(aguardando…)</em>' : ctx.net ? ' <em>— sua vez!</em>' : '';
    banner.innerHTML = `<span class="dot" style="--pc:${p.color};--st:${p.stroke}"></span> Vez de <strong>${escapeHTML(seat.name)}</strong>${note}`;
  }
  $('#variant-label').textContent = ctx.variantName + (ctx.net ? ` · Sala ${ctx.net.code}` : '');

  $('#player-list').innerHTML = s.participants.map(p => {
    const pl = s.players[p];
    const seat = seatOf(p);
    let status = '';
    if (!s.alive[p]) status = '<span class="st out">eliminado</span>';
    else if (s.status === 'playing' && isInCheck(s, p)) status = '<span class="st chk">xeque!</span>';
    const team = s.teams ? `<span class="st team">Equipe ${p % 2 ? 'B' : 'A'}</span>` : '';
    return `<li class="${s.turn === p && s.status === 'playing' ? 'active' : ''} ${s.alive[p] ? '' : 'dead'}">
      <span class="dot" style="--pc:${pl.color};--st:${pl.stroke}"></span>
      <span class="pname">${escapeHTML(seat.name)}${seat.type === 'bot' ? ' 🤖' : ''}${seat.type === 'remote' ? ' 🌐' : ''}${ctx.net && seat.type === 'human' ? ' (você)' : ''}</span>${team}${status}</li>`;
  }).join('');

  const log = $('#move-log');
  log.innerHTML = s.log.map(e => {
    if (e.sys) return `<li class="sys">${escapeHTML(e.text)}</li>`;
    const pl = s.players[e.p];
    const txt = e.castle ? `roque ${e.from}→${e.to}` : `${e.from}${e.cap ? '×' : '→'}${e.to}${e.promo ? ' = ' + PIECE_TYPES[e.promo].name : ''}`;
    return `<li>${pieceHTML(e.t, pl, 'mini')} ${txt}${e.suffix}</li>`;
  }).join('');
  log.scrollTop = log.scrollHeight;

  $('#btn-undo').disabled = !!ctx.net || !ctx.history.length || s.status === 'over';
  $('#btn-resign').disabled = !isHumanTurn();
  $('#btn-new').textContent = ctx.net ? 'Sair da sala' : 'Novo jogo';
}

function onSquare(r, c) {
  if (!ctx || !isHumanTurn()) return;
  const s = ctx.state;
  const pc = s.board[r][c];
  if (ctx.selected) {
    const options = legalMoves(s).filter(m => m.fr === ctx.selected.r && m.fc === ctx.selected.c && m.tr === r && m.tc === c);
    if (options.length === 1) return play(options[0]);
    if (options.length > 1) return askPromotion(options);
  }
  if (pc && pc.o === s.turn && !(ctx.selected && ctx.selected.r === r && ctx.selected.c === c)) {
    ctx.selected = { r, c };
  } else {
    ctx.selected = null;
  }
  refresh();
}

function askPromotion(options) {
  const pl = ctx.state.players[ctx.state.turn];
  const card = showModal(`<h2>Promover peão</h2><p>Escolha a nova peça:</p>
    <div class="promo-grid">${options.map((m, i) => `<button data-i="${i}">${pieceHTML(m.promo, pl)}<span>${PIECE_TYPES[m.promo].name}</span></button>`).join('')}</div>`);
  card.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => {
    closeModal();
    play(options[+b.dataset.i]);
  }));
}

const serialize = m => ({ fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc, promo: m.promo || null });

function play(move) {
  commit(serialize(move), true);
}

// Aplica um lance serializado ({fr, fc, tr, tc, promo} ou {resign: true}) ao estado.
function applySer(ser) {
  let next;
  if (ser.resign) {
    if (ctx.state.status !== 'playing') return false;
    next = resign(ctx.state);
  } else {
    const m = legalMoves(ctx.state).find(x => sameMove(x, ser));
    if (!m) return false;
    next = makeMove(ctx.state, m);
  }
  ctx.history.push(ctx.state);
  ctx.state = next;
  ctx.moves.push(ser);
  return true;
}

function commit(ser, broadcast) {
  const seq = ctx.moves.length;
  if (!applySer(ser)) return false;
  ctx.selected = null;
  if (broadcast && ctx.net) ctx.net.send('move', { gameId: ctx.config.gameId, seq, move: ser });
  afterMove();
  return true;
}

function afterMove() {
  refresh();
  if (ctx.state.status === 'over') return gameOver();
  maybeBot();
}

function maybeBot() {
  const s = ctx.state;
  if (s.status !== 'playing' || seatOf(s.turn).type !== 'bot' || !runsBots()) return;
  const game = ctx;
  clearTimeout(ctx.botTimer);
  ctx.botTimer = setTimeout(() => {
    if (ctx !== game || seatOf(ctx.state.turn).type !== 'bot') return;
    const m = chooseMove(ctx.state);
    if (m) commit(serialize(m), true);
  }, 450);
}

async function gameOver() {
  const game = ctx;
  const s = ctx.state;
  let deltas = [];
  let note = '';
  if (!ctx.recorded) {
    ctx.recorded = true;
    const seats = s.participants.map(seatOf);
    const ranks = s.participants.map(p => s.result.rank[p]);
    const humans = seats.filter(seat => seat.type !== 'bot');
    const me = currentUser();
    // Vale para o ranking global quando todos os humanos têm conta e eu sou um deles.
    const rated = humans.length > 0 && humans.every(seat => seat.userId) && me && humans.some(seat => seat.userId === me.id);
    if (rated) {
      try {
        const res = await reportMatch(ctx.config.gameId, ctx.variantName, seats.map((seat, i) => ({
          user_id: seat.type === 'bot' ? null : seat.userId, bot: seat.type === 'bot', rank: ranks[i],
        })));
        if (res.status === 'pending') {
          note = `Resultado enviado ao ranking global. Ele vale quando todos confirmarem (${res.confirmed}/${res.needed}).`;
        } else {
          deltas = res.deltas;
          note = 'Resultado registrado no ranking global.';
        }
      } catch (err) {
        console.error(err);
        note = `Não foi possível registrar no ranking global: ${err.message}`;
      }
    } else if (runsBots() && humans.length) {
      deltas = recordLocal(ctx.variantName, seats.map((seat, i) => ({ name: seat.name, bot: seat.type === 'bot', rank: ranks[i] })));
      note = 'Resultado salvo no ranking deste navegador'
        + (supabaseEnabled() ? ' (para valer no ranking global, todos os jogadores precisam estar logados).' : '.');
    }
    if (ctx !== game) return;
  }
  const rows = s.participants
    .map((p, i) => ({ p, rank: s.result.rank[p], d: deltas[i] }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ p, rank, d }) => {
      const pl = s.players[p];
      const seat = seatOf(p);
      const delta = seat.type === 'bot' || d == null ? '' : `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</span>`;
      return `<li><b>${rank}º</b><span class="dot" style="--pc:${pl.color};--st:${pl.stroke}"></span>${escapeHTML(seat.name)} ${delta}</li>`;
    }).join('');
  setTimeout(() => {
    const card = showModal(`
      <h2>${s.result.type === 'draw' ? 'Empate!' : 'Fim de jogo!'}</h2>
      <p>${escapeHTML(s.result.reason)}</p>
      <ol class="final">${rows}</ol>
      ${note ? `<p class="muted">${note}</p>` : ''}
      <div class="actions">
        ${ctx.net ? '<button class="btn" data-a="lobby">Voltar à sala</button>' : '<button class="btn" data-a="again">Jogar de novo</button>'}
        <button class="btn ghost" data-a="rank">Ver ranking</button>
        <button class="btn ghost" data-a="close">Fechar</button>
      </div>`);
    card.addEventListener('click', e => {
      const a = e.target.dataset.a;
      if (!a) return;
      closeModal();
      if (a === 'again') startGame(ctx.config);
      if (a === 'lobby') location.hash = '#sala';
      if (a === 'rank') location.hash = '#ranking';
    });
  }, 500);
}

export function initGameControls() {
  $('#btn-mode').addEventListener('click', () => ctx && setMode(ctx.mode === '3d' ? '2d' : '3d'));
  $('#btn-rotate').addEventListener('click', () => {
    if (!ctx) return;
    ctx.rot = (ctx.rot + (ctx.state.w !== ctx.state.h && ctx.mode !== '3d' ? 2 : 1)) % 4;
    refresh();
  });
  $('#btn-undo').addEventListener('click', () => {
    if (!ctx || ctx.net || !ctx.history.length) return;
    clearTimeout(ctx.botTimer);
    do { ctx.state = ctx.history.pop(); ctx.moves.pop(); } while (ctx.history.length && seatOf(ctx.state.turn).type !== 'human');
    ctx.selected = null;
    refresh();
    maybeBot();
  });
  $('#btn-resign').addEventListener('click', async () => {
    if (!ctx || !isHumanTurn()) return;
    const game = ctx;
    const ok = await confirmDialog({
      title: `${seatOf(ctx.state.turn).name}, deseja desistir?`,
      message: ctx.state.participants.filter(p => ctx.state.alive[p]).length > 2
        ? 'Você será eliminado e a partida continua entre os demais.'
        : 'A partida termina e o adversário vence.',
      confirmText: 'Desistir', danger: true,
    });
    if (!ok || ctx !== game || !isHumanTurn()) return;
    commit({ resign: true }, true);
  });
  $('#btn-new').addEventListener('click', async () => {
    if (ctx && ctx.state.status === 'playing' && ctx.moves.length) {
      const ok = await confirmDialog({
        title: ctx.net ? 'Sair da sala?' : 'Abandonar esta partida?',
        message: ctx.net ? 'Você sai da sala e da partida em andamento.' : 'A partida em andamento será perdida.',
        confirmText: ctx.net ? 'Sair' : 'Abandonar', danger: true,
      });
      if (!ok) return;
    }
    location.hash = '#jogar';
  });
  $$('#opt-autorotate, #opt-hints').forEach(el => el.addEventListener('change', refresh));
}
