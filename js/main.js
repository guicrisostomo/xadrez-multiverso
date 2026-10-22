// Navegação entre as telas (rotas por hash) e inicialização.
import { initSetup, initGameControls, hasGame, stopGame } from './game.js';
import { initTutorial, initPieces, maybeOfferTutorial } from './tutorial.js';
import { loadRanking, resetRanking } from './ranking.js';
import { $, $$, escapeHTML, closeModal } from './ui.js';

const ROUTES = { jogar: 'view-play', partida: 'view-game', tutorial: 'view-tutorial', pecas: 'view-pieces', ranking: 'view-ranking' };

function route() {
  let name = location.hash.slice(1) || 'jogar';
  if (name === 'partida' && !hasGame()) name = 'jogar';
  if (!ROUTES[name]) name = 'jogar';
  if (name !== 'partida' && hasGame() && name === 'jogar') stopGame();
  closeModal();
  $$('.view').forEach(v => { v.hidden = v.id !== ROUTES[name]; });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${name === 'partida' ? 'jogar' : name}`));
  if (name === 'ranking') renderRanking();
  window.scrollTo(0, 0);
}

function renderRanking() {
  const data = loadRanking();
  const players = Object.values(data.players).sort((a, b) => b.rating - a.rating);
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

initSetup();
initGameControls();
initTutorial();
initPieces();
$('#btn-reset-ranking').addEventListener('click', () => {
  if (confirm('Apagar todo o ranking salvo neste navegador?')) { resetRanking(); renderRanking(); }
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') e.currentTarget.hidden = true; });
window.addEventListener('hashchange', route);
route();
maybeOfferTutorial();
