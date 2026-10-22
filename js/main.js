// Navegação entre as telas (rotas por hash) e inicialização.
import { initSetup, initGameControls, hasGame } from './game.js';
import { initTutorial, initPieces, maybeOfferTutorial } from './tutorial.js';
import { initOnline, inRoom, joinFromLink, leaveEverything, lobbyChanged } from './online.js';
import { initAuth } from './auth.js';
import { initRankingView, renderRanking } from './ranking-view.js';
import { initProfile, showProfile } from './profile.js';
import { $, $$, closeModal, initModal } from './ui.js';

const ROUTES = {
  jogar: 'view-play', partida: 'view-game', sala: 'view-lobby', tutorial: 'view-tutorial',
  pecas: 'view-pieces', ranking: 'view-ranking', perfil: 'view-profile', jogador: 'view-profile',
};
const TITLES = {
  jogar: 'Jogar', partida: 'Partida', sala: 'Sala online', tutorial: 'Tutorial', pecas: 'Peças',
  ranking: 'Ranking', perfil: 'Meu perfil', jogador: 'Jogador',
};

function route() {
  let name = location.hash.slice(1) || 'jogar';
  closeModal();
  const link = name.match(/^sala=([A-Za-z0-9]{5})$/);
  if (link) { showView('view-play', 'jogar'); joinFromLink(link[1].toUpperCase()); return; }
  const player = name.match(/^jogador\/([0-9a-f-]{36})$/i);
  if (player) name = 'jogador';
  if (name === 'partida' && !hasGame()) name = 'jogar';
  if (name === 'sala' && !inRoom()) name = 'jogar';
  if (!ROUTES[name]) name = 'jogar';
  if (name === 'jogar') leaveEverything();
  if (name === 'sala') lobbyChanged();
  const nav = { partida: 'jogar', sala: 'jogar', jogador: 'ranking' }[name] || name;
  showView(ROUTES[name], nav);
  document.title = `${TITLES[name]} · Xadrez Multiverso`;
  if (name === 'ranking') renderRanking();
  if (name === 'perfil') showProfile('me');
  if (name === 'jogador') showProfile(player[1]);
  window.scrollTo(0, 0);
}

function showView(id, nav) {
  $$('.view').forEach(v => { v.hidden = v.id !== id; });
  $$('.nav a').forEach(a => {
    const active = a.getAttribute('href') === `#${nav}`;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#account-btn')?.classList.toggle('active', nav === 'perfil');
}

// Atalhos que rolam até uma seção sem mexer na rota (as rotas usam o #).
document.addEventListener('click', e => {
  const el = e.target.closest('[data-scroll]');
  if (!el) return;
  e.preventDefault();
  const target = document.getElementById(el.dataset.scroll);
  if (!target) return;
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  target.focus?.({ preventScroll: true });
});

initModal();
initAuth();
initSetup();
initGameControls();
initTutorial();
initPieces();
initOnline();
initRankingView();
initProfile();
window.addEventListener('hashchange', route);
route();
maybeOfferTutorial();
