// Salas online com Supabase Realtime: presença mostra quem está na sala e
// broadcast distribui a configuração e os lances. O anfitrião é a referência:
// ele inicia as partidas, joga pelos computadores, reenvia o histórico a quem
// reconecta e registra o resultado no ranking.
import { getSupabase, supabaseEnabled } from './supabase.js';
import { VARIANTS, CROSS_SEATS } from './variants.js';
import { currentUser, onAuthChange } from './auth.js';
import { startGame, receiveMove, currentGame, setSeatType, stopGame } from './game.js';
import { $, store, escapeHTML, toast, showModal, closeModal } from './ui.js';

const SETUP_KEY = 'xadrez.setup.v1';
const NAME_KEY = 'xadrez.online.name';
const RECONNECT_GRACE_MS = 20000;

function clientId() {
  let id = null;
  try { id = sessionStorage.getItem('xadrez.clientId'); } catch { /* sem sessionStorage */ }
  if (!id) {
    id = crypto.randomUUID();
    try { sessionStorage.setItem('xadrez.clientId', id); } catch { /* sem sessionStorage */ }
  }
  return id;
}
const myId = clientId();

let room = null;

const randomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const shareLink = code => `${location.origin}${location.pathname}#sala=${code}`;

export const inRoom = () => !!room;

// ---------------------------------------------------------------- conexão

const presenceInfo = r => ({ name: r.name, joinedAt: r.joinedAt, host: r.isHost, userId: currentUser()?.id ?? null });

async function connect(code, name, isHost, lobby) {
  leaveRoom();
  if (currentUser()) name = currentUser().username;
  const sb = await getSupabase();
  const channel = sb.channel(`xadrez-sala-${code}`, {
    config: { presence: { key: myId }, broadcast: { self: false } },
  });
  const r = { code, name, isHost, channel, members: [], lobby, joinedAt: Date.now(), netConfig: null, absent: new Map() };
  room = r;

  channel.on('presence', { event: 'sync' }, () => {
    if (room !== r) return;
    const state = channel.presenceState();
    const before = new Set(r.members.map(m => m.id));
    r.members = Object.entries(state).map(([id, metas]) => ({ id, ...metas[0] })).sort((a, b) => a.joinedAt - b.joinedAt);
    const now = new Set(r.members.map(m => m.id));
    for (const id of before) if (!now.has(id)) onMemberLeft(id);
    for (const id of now) if (!before.has(id)) onMemberJoined(id);
    renderLobby();
  });
  channel.on('broadcast', { event: 'move' }, ({ payload }) => receiveMove(payload));
  channel.on('broadcast', { event: 'start' }, ({ payload }) => onStart(payload));
  channel.on('broadcast', { event: 'lobby' }, ({ payload }) => { if (!r.isHost) { r.lobby = payload; renderLobby(); } });
  channel.on('broadcast', { event: 'seat' }, ({ payload }) => setSeatType(payload.gameId, payload.p, payload.type));
  channel.on('broadcast', { event: 'sync-request' }, ({ payload }) => { if (r.isHost) sendSnapshot(payload.from); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tempo esgotado')), 10000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(status)); }
    });
  });
  await channel.track(presenceInfo(r));
  store.set(NAME_KEY, name);
  location.hash = '#sala';
  renderLobby();
  if (!isHost) send('sync-request', { from: myId });
}

function send(event, payload) {
  room?.channel.send({ type: 'broadcast', event, payload });
}

export function leaveRoom() {
  if (!room) return;
  const r = room;
  room = null;
  for (const t of r.absent.values()) clearTimeout(t);
  r.channel.untrack().finally(() => r.channel.unsubscribe());
}

function netHandle() {
  const r = room;
  return {
    code: r.code,
    isHost: r.isHost,
    send: (event, payload) => { if (room === r) send(event, payload); },
    requestSync: () => { if (room === r && !r.isHost) send('sync-request', { from: myId }); },
  };
}

// ---------------------------------------------------------------- entrada e saída de jogadores

function seatIndexOf(id) {
  return room.netConfig ? room.netConfig.seats.findIndex(s => s.clientId === id) : -1;
}

function onMemberJoined(id) {
  const t = room.absent.get(id);
  if (t) { clearTimeout(t); room.absent.delete(id); }
  if (room.isHost && id !== myId) send('lobby', room.lobby);
  const m = room.members.find(x => x.id === id);
  if (id !== myId && m && room.joinedAt < m.joinedAt) toast(`${m.name} entrou na sala`);
}

function onMemberLeft(id) {
  if (!room) return;
  const gone = room.netConfig?.seats.find(s => s.clientId === id);
  const hostGone = !room.members.some(m => m.host);
  if (hostGone && !room.isHost) {
    toast('O anfitrião saiu da sala. A partida não pode continuar.', 'warn');
    return;
  }
  if (!gone) return;
  toast(`${gone.name} desconectou…`, 'warn');
  if (!room.isHost) return;
  // Se não voltar a tempo, o computador assume o lugar.
  const r = room;
  r.absent.set(id, setTimeout(() => {
    r.absent.delete(id);
    const game = currentGame();
    const p = seatIndexOf(id);
    if (room !== r || p < 0 || !game || game.gameId !== r.netConfig.gameId || game.state.status !== 'playing') return;
    r.netConfig.seats[p] = { ...r.netConfig.seats[p], type: 'bot', clientId: null, name: `${r.netConfig.seats[p].name} (PC)` };
    send('seat', { gameId: game.gameId, p, type: 'bot' });
    setSeatType(game.gameId, p, 'bot');
    toast(`O computador assumiu o lugar de ${gone.name}.`);
  }, RECONNECT_GRACE_MS));
}

// ---------------------------------------------------------------- partida

function localMode() {
  return store.get(SETUP_KEY, {}).mode || '2d';
}

function onStart({ config, moves, to }) {
  if (!room || (to && to !== myId)) return;
  room.netConfig = config;
  const game = currentGame();
  if (game && game.gameId === config.gameId && moves.length <= game.moves.length) return;
  const local = {
    ...config,
    mode: game?.config.mode || localMode(),
    seats: config.seats.map(s => (s.type === 'net' ? { ...s, type: s.clientId === myId ? 'human' : 'remote' } : s)),
  };
  startGame(local, netHandle(), moves);
}

function sendSnapshot(to) {
  const game = currentGame();
  if (!room.netConfig || !game || game.gameId !== room.netConfig.gameId) return;
  send('start', { config: room.netConfig, moves: game.moves, to });
}

function hostStart() {
  const { variant, teams, newPieces, fill } = room.lobby;
  const options = VARIANTS[variant].options || {};
  const n = VARIANTS[variant].build({}).players.length;
  const players = room.members.slice(0, n);
  const leaveEmpty = fill === 'empty' && n === 4;
  // No tabuleiro em cruz com lugares vazios, 2 jogadores ficam frente a frente.
  const order = leaveEmpty && CROSS_SEATS[players.length] ? CROSS_SEATS[players.length] : players.map((_, i) => i);
  const usedNames = new Set();
  const usedAccounts = new Set();
  const seats = Array.from({ length: n }, (_, i) => {
    const m = players[order.indexOf(i)];
    if (!m) return leaveEmpty ? { name: 'Vazio', type: 'empty' } : { name: `Computador ${i + 1}`, type: 'bot' };
    let name = m.name;
    for (let k = 2; usedNames.has(name.toLowerCase()); k++) name = `${m.name.slice(0, 17)} ${k}`;
    usedNames.add(name.toLowerCase());
    // A mesma conta em duas abas só vale uma vez.
    const userId = m.userId && !usedAccounts.has(m.userId) ? m.userId : null;
    if (userId) usedAccounts.add(userId);
    return { name, type: 'net', clientId: m.id, userId };
  });
  if (seats.filter(s => s.type !== 'empty').length < 2) return toast('São necessários pelo menos 2 jogadores.', 'warn');
  if (options.teams && teams && seats.some(s => s.type === 'empty')) return toast('O modo equipes precisa dos 4 assentos ocupados.', 'warn');
  if (room.members.length > n) toast(`${room.members.length - n} pessoa(s) vão assistir à partida.`);
  const config = { variant, teams: !!options.teams && teams, newPieces: !!options.newPieces && newPieces, seats, gameId: crypto.randomUUID() };
  send('start', { config, moves: [] });
  onStart({ config, moves: [] });
}

// ---------------------------------------------------------------- interface

function renderLobby() {
  if (!room) return;
  $('#room-code').textContent = room.code;
  $('#room-link').value = shareLink(room.code);
  const v = VARIANTS[room.lobby.variant];
  const n = v.build({}).players.length;
  $('#room-members').innerHTML = room.members.map((m, i) => `
    <li><span class="seat-n">${i < n ? `${i + 1}º` : '👀'}</span> ${escapeHTML(m.name)}${m.userId ? ' <span title="Conta verificada">✔</span>' : ''}
      ${m.host ? '<span class="st team">anfitrião</span>' : ''}${m.id === myId ? '<span class="st team">você</span>' : ''}</li>`).join('');
  const playing = room.members.slice(0, n);
  $('#lobby-rated').textContent = playing.every(m => m.userId)
    ? '🏆 Todos estão logados: a partida vale para o ranking global.'
    : '🔒 Para valer no ranking global, todos os jogadores precisam entrar na conta (botão no topo).';
  const form = $('#lobby-form');
  form.variant.value = room.lobby.variant;
  form.teams.checked = !!room.lobby.teams;
  form.newPieces.checked = !!room.lobby.newPieces;
  form.fill.value = room.lobby.fill || 'bot';
  for (const el of form.elements) el.disabled = !room.isHost;
  $('#lobby-four').hidden = !v.options;
  $('#lobby-opt-teams').hidden = !v.options?.teams;
  $('#lobby-opt-new-pieces').hidden = !v.options?.newPieces;
  $('#btn-room-start').hidden = !room.isHost;
  $('#lobby-wait').hidden = room.isHost;
  const game = currentGame();
  const running = game && room.netConfig && game.gameId === room.netConfig.gameId && game.state.status === 'playing';
  $('#btn-room-return').hidden = !running;
}

export function initOnline() {
  if (!supabaseEnabled()) {
    $('#online-box').hidden = true;
    return;
  }
  const syncName = user => {
    const input = $('#online-name');
    input.readOnly = !!user;
    input.value = user ? user.username : store.get(NAME_KEY, '');
  };
  syncName(currentUser());
  onAuthChange(user => {
    syncName(user);
    // Atualiza a presença na sala para refletir login/logout.
    if (room) {
      if (user) room.name = user.username;
      room.channel.track(presenceInfo(room));
    }
  });
  $('#lobby-form').variant.innerHTML = Object.entries(VARIANTS).map(([id, v]) => `<option value="${id}">${v.name} (${v.tag})</option>`).join('');

  const nameOrWarn = () => {
    const name = $('#online-name').value.trim();
    if (!name) { toast('Digite seu nome para jogar online.', 'warn'); $('#online-name').focus(); }
    return name;
  };
  const run = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } catch (err) {
      console.error(err);
      toast('Não foi possível conectar à sala. Tente novamente.', 'error');
    } finally { btn.disabled = false; }
  };

  $('#btn-create-room').addEventListener('click', e => {
    const name = nameOrWarn();
    if (!name) return;
    const form = $('#setup-form');
    const lobby = { variant: form.variant.value, teams: form.teams.checked, newPieces: form.newPieces.checked, fill: 'bot' };
    run(e.currentTarget, () => connect(randomCode(), name, true, lobby));
  });
  $('#btn-join-room').addEventListener('click', e => {
    const name = nameOrWarn();
    const code = $('#online-code').value.trim().toUpperCase();
    if (!name) return;
    if (!/^[A-Z0-9]{5}$/.test(code)) return toast('O código da sala tem 5 letras/números.', 'warn');
    run(e.currentTarget, () => connect(code, name, false, { variant: 'classic', fill: 'bot' }));
  });

  $('#lobby-form').addEventListener('change', e => {
    if (!room?.isHost) return;
    const f = e.currentTarget;
    room.lobby = { variant: f.variant.value, teams: f.teams.checked, newPieces: f.newPieces.checked, fill: f.fill.value };
    send('lobby', room.lobby);
    renderLobby();
  });
  $('#btn-room-start').addEventListener('click', () => room?.isHost && hostStart());
  $('#btn-room-return').addEventListener('click', () => { location.hash = '#partida'; });
  $('#btn-room-leave').addEventListener('click', () => { location.hash = '#jogar'; });
  $('#btn-copy-link').addEventListener('click', async () => {
    const btn = $('#btn-copy-link');
    try {
      await navigator.clipboard.writeText(shareLink(room.code));
      btn.textContent = 'Copiado ✓';
      setTimeout(() => { btn.textContent = 'Copiar link'; }, 1800);
    } catch {
      $('#room-link').select();
      toast('Selecionei o link: use Ctrl+C para copiar.', 'info');
    }
  });
}

// Chamado pelo roteador para links do tipo #sala=ABCDE.
export function joinFromLink(code) {
  if (!supabaseEnabled()) { location.hash = '#jogar'; return; }
  if (room?.code === code) { location.hash = '#sala'; return; }
  const card = showModal(`
    <h2>Entrar na sala ${escapeHTML(code)}</h2>
    <p>Como você quer ser chamado na partida?</p>
    <input id="link-name" class="text-input" maxlength="20" value="${escapeHTML(store.get(NAME_KEY, ''))}" placeholder="Seu nome">
    <div class="actions">
      <button class="btn" data-a="join">Entrar</button>
      <button class="btn ghost" data-a="cancel">Cancelar</button>
    </div>`);
  const input = card.querySelector('#link-name');
  input.focus();
  const go = async () => {
    const name = input.value.trim();
    if (!name) return input.focus();
    closeModal();
    try { await connect(code, name, false, { variant: 'classic', fill: 'bot' }); } catch (err) {
      console.error(err);
      toast('Não foi possível conectar à sala.', 'error');
      location.hash = '#jogar';
    }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  card.addEventListener('click', e => {
    if (e.target.dataset.a === 'join') go();
    if (e.target.dataset.a === 'cancel') { closeModal(); location.hash = '#jogar'; }
  });
}

export function leaveEverything() {
  stopGame();
  leaveRoom();
}

export function lobbyChanged() { renderLobby(); }
