// Navegação entre as telas (rotas por hash) e inicialização.
import { initSetup, initGameControls, hasGame } from './game.js';
import { initTutorial, initPieces, maybeOfferTutorial } from './tutorial.js';
import { loadRanking, loadGlobalRanking, resetRanking } from './ranking.js';
import { initOnline, inRoom, joinFromLink, leaveEverything, lobbyChanged } from './online.js';
import { supabaseEnabled } from './supabase.js';
import { initAuth } from './auth.js';
import { $, $$, escapeHTML, closeModal } from './ui.js';

const ROUTES = { jogar: 'view-play', partida: 'view-game', sala: 'view-lobby', tutorial: 'view-tutorial', pecas: 'view-pieces', ranking: 'view-ranking' };

function route() {
  let name = location.hash.slice(1) || 'jogar';
  closeModal();
  const link = name.match(/^sala=([A-Za-z0-9]{5})$/);
  if (link) { showView('view-play'); joinFromLink(link[1].toUpperCase()); return; }
  if (name === 'partida' && !hasGame()) name = 'jogar';
  if (name === 'sala' && !inRoom()) name = 'jogar';
  if (!ROUTES[name]) name = 'jogar';
  if (name === 'jogar') leaveEverything();
  if (name === 'sala') lobbyChanged();
  showView(ROUTES[name], name === 'partida' || name === 'sala' ? 'jogar' : name);
  if (name === 'ranking') renderRanking();
  window.scrollTo(0, 0);
}

function showView(id, nav = 'jogar') {
  $$('.view').forEach(v => { v.hidden = v.id !== id; });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${nav}`));
}

let rankingRequest = 0;

async function renderRanking() {
  const scope = supabaseEnabled() ? $('input[name=rankScope]:checked').value : 'local';
  $('#ranking-tabs').hidden = !supabaseEnabled();
  $('#btn-reset-ranking').hidden = scope !== 'local';
  const status = $('#ranking-status');
  let data;
  if (scope === 'global') {
    const req = ++rankingRequest;
    status.textContent = 'Carregando ranking global…';
    try {
      data = await loadGlobalRanking();
      status.textContent = '';
    } catch (err) {
      console.error(err);
      data = { players: [], matches: [] };
      status.textContent = 'Não foi possível carregar o ranking global agora.';
    }
    if (req !== rankingRequest) return;
  } else {
    rankingRequest++;
    const local = loadRanking();
    data = { players: Object.values(local.players), matches: local.matches };
    status.textContent = 'Partidas salvas só neste navegador (usado quando o ranking global não está disponível).';
  }
  fillRanking(data);
}

function fillRanking(data) {
  const players = data.players.slice().sort((a, b) => b.rating - a.rating);
  $('#ranking-body').innerHTML = players.length ? players.map((p, i) => `
    <tr>
      <td class="pos">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
      <td>${escapeHTML(p.name)}</td>
      <td class="num"><strong>${p.rating}</strong></td>
      <td class="num">${p.games}</td>
      <td class="num">${p.wins}</td>
      <td class="num">${p.draws}</td>
      <td class="num">${p.losses}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Nenhuma partida registrada ainda. Jogue uma partida para entrar no ranking!</td></tr>';
  $('#match-list').innerHTML = data.matches.map(m => `
    <li><span class="when">${new Date(m.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
      <span class="var">${escapeHTML(m.variant)}</span>
      <span>${m.entries.slice().sort((a, b) => a.rank - b.rank).map(e => `${e.rank}º ${escapeHTML(e.name)}${e.bot ? ' 🤖' : ` (${e.delta >= 0 ? '+' : ''}${e.delta})`}`).join(' · ')}</span></li>`).join('')
    || '<li class="empty">Sem partidas recentes.</li>';
}

initAuth();
initSetup();
initGameControls();
initTutorial();
initPieces();
initOnline();
$('#ranking-tabs').addEventListener('change', renderRanking);
$('#btn-reset-ranking').addEventListener('click', () => {
  if (confirm('Apagar todo o ranking salvo neste navegador?')) { resetRanking(); renderRanking(); }
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') e.currentTarget.hidden = true; });
window.addEventListener('hashchange', route);
route();
maybeOfferTutorial();
