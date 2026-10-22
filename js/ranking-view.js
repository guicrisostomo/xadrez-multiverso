// Página do ranking: pódio, tabela com busca, sua posição e partidas recentes.
// Também exporta o cartão de partida usado no perfil.
import { loadRanking, loadGlobalRanking, resetRanking } from './ranking.js';
import { supabaseEnabled } from './supabase.js';
import { currentUser, onAuthChange, openLogin } from './auth.js';
import { $, $$, escapeHTML, confirmDialog, toast, timeAgo, avatarHTML } from './ui.js';

const MEDAL = ['🥇', '🥈', '🥉'];

let data = { players: [], matches: [] };
let scope = 'global';
let matchFilter = 'all';
let request = 0;

const winRate = p => (p.games ? Math.round((p.wins / p.games) * 100) : 0);
const playerLink = (p, inner) => (p.user_id ? `<a class="plink" href="#jogador/${p.user_id}">${inner}</a>` : inner);

// Cartão de partida. highlightId: user_id a destacar (o dono do perfil).
export function matchCardHTML(m, { highlightId = null, highlightName = null } = {}) {
  const entries = m.entries.slice().sort((a, b) => a.rank - b.rank);
  const tied = entries.every(e => e.rank === entries[0].rank);
  const mine = entries.find(e => (highlightId && e.user_id === highlightId) || (highlightName && !e.bot && e.name === highlightName));
  let badge = '';
  if (mine) {
    const label = tied ? 'Empate' : mine.rank === 1 ? 'Vitória' : entries.length > 2 ? `${mine.rank}º lugar` : 'Derrota';
    const cls = tied ? 'draw' : mine.rank === 1 ? 'win' : 'loss';
    badge = `<span class="result ${cls}">${label}</span>`;
  }
  return `<li class="match-card ${mine ? 'has-me' : ''}">
    <div class="mc-head">
      <span class="chip">${escapeHTML(m.variant)}</span>${badge}
      <time datetime="${escapeHTML(m.date)}" title="${new Date(m.date).toLocaleString('pt-BR')}">${timeAgo(m.date)}</time>
    </div>
    <ol class="mc-players">${entries.map(e => {
      const isMe = e === mine;
      const delta = e.bot || e.delta == null ? '' : `<span class="delta ${e.delta >= 0 ? 'up' : 'down'}">${e.delta >= 0 ? '+' : ''}${e.delta}</span>`;
      const name = `${avatarHTML(e.name, null, 'xs')}<span class="mc-name">${escapeHTML(e.name)}${e.bot ? ' 🤖' : ''}</span>`;
      return `<li class="${isMe ? 'me' : ''}"><b class="mc-rank">${tied ? '=' : `${e.rank}º`}</b>${e.user_id ? playerLink(e, name) : name}${delta}</li>`;
    }).join('')}</ol>
  </li>`;
}

function skeleton() {
  $('#podium').innerHTML = '';
  $('#ranking-body').innerHTML = Array.from({ length: 5 }, () =>
    '<tr class="skeleton"><td colspan="6"><span></span></td></tr>').join('');
  $('#match-list').innerHTML = Array.from({ length: 3 }, () => '<li class="match-card skeleton"><span></span></li>').join('');
}

export async function renderRanking() {
  const online = supabaseEnabled();
  if (!online) scope = 'local';
  $('#ranking-tabs').hidden = !online;
  $('#btn-reset-ranking').hidden = scope !== 'local';
  $('#match-filter').hidden = scope !== 'global' || !currentUser();
  const status = $('#ranking-status');
  status.textContent = '';
  if (scope === 'global') {
    const req = ++request;
    skeleton();
    try {
      const fresh = await loadGlobalRanking();
      if (req !== request) return;
      data = fresh;
    } catch (err) {
      console.error(err);
      if (req !== request) return;
      data = { players: [], matches: [] };
      status.innerHTML = '⚠️ Não foi possível carregar o ranking global agora. <button class="link-btn" type="button" data-retry>Tentar de novo</button>';
      status.querySelector('[data-retry]').addEventListener('click', renderRanking);
    }
  } else {
    request++;
    const local = loadRanking();
    data = { players: Object.values(local.players), matches: local.matches };
    status.textContent = 'Partidas que não valem para o ranking global (por exemplo, com jogadores sem conta) ficam salvas só neste navegador.';
  }
  fill();
}

function fill() {
  const me = currentUser();
  const query = $('#ranking-search').value.trim().toLowerCase();
  const all = data.players.slice().sort((a, b) => b.rating - a.rating).map((p, i) => ({ ...p, pos: i + 1 }));
  const isMe = p => scope === 'global' && me && p.user_id === me.id;

  // Sua posição
  const mine = scope === 'global' && me ? all.find(isMe) : null;
  const card = $('#my-rank');
  card.hidden = scope !== 'global';
  if (scope === 'global') {
    if (!me) {
      card.innerHTML = `<div class="mr-text"><strong>Entre para aparecer no ranking</strong><span class="muted">Partidas com todos os jogadores logados contam pontos Elo.</span></div>
        <button class="btn small" type="button" data-login>Entrar</button>`;
      card.querySelector('[data-login]').addEventListener('click', () => openLogin());
    } else if (mine) {
      card.innerHTML = `${avatarHTML(me.username, me.avatarUrl, 'md')}
        <div class="mr-text"><strong>Você está em ${mine.pos}º lugar</strong><span class="muted">${mine.rating} Elo · ${mine.games} partidas · ${winRate(mine)}% de vitórias</span></div>
        <a class="btn small ghost" href="#perfil">Meu perfil</a>`;
    } else {
      card.innerHTML = `${avatarHTML(me.username, me.avatarUrl, 'md')}
        <div class="mr-text"><strong>Você ainda não está no ranking</strong><span class="muted">Jogue uma partida valendo ranking (contra o computador ou numa sala online com contas).</span></div>
        <a class="btn small" href="#jogar">Jogar</a>`;
    }
  }

  // Pódio (só sem busca)
  const podium = $('#podium');
  const top = query ? [] : all.slice(0, 3);
  podium.hidden = top.length === 0;
  podium.innerHTML = top.map((p, i) => playerLink(p, `
    <div class="podium-card p${i + 1} ${isMe(p) ? 'me' : ''}">
      <span class="medal">${MEDAL[i]}</span>
      ${avatarHTML(p.name, isMe(p) ? me.avatarUrl : null, 'lg')}
      <strong>${escapeHTML(p.name)}</strong>
      <span class="elo">${p.rating}</span>
      <span class="muted small">${p.games} partidas · ${winRate(p)}%</span>
    </div>`)).join('');

  const rows = query ? all.filter(p => p.name.toLowerCase().includes(query)) : all;
  $('#ranking-body').innerHTML = rows.length ? rows.map(p => `
    <tr class="${isMe(p) ? 'me' : ''} ${p.user_id ? 'clickable' : ''}" ${p.user_id ? `data-user="${p.user_id}"` : ''}>
      <td class="pos">${p.pos <= 3 ? MEDAL[p.pos - 1] : p.pos}</td>
      <td><span class="pcell">${avatarHTML(p.name, isMe(p) ? me.avatarUrl : null, 'sm')}${playerLink(p, escapeHTML(p.name))}${isMe(p) ? ' <span class="chip small">você</span>' : ''}</span></td>
      <td class="num"><strong>${p.rating}</strong></td>
      <td class="num hide-sm">${p.games}</td>
      <td class="num hide-sm"><span class="wdl"><span class="w">${p.wins}</span>/<span class="d">${p.draws}</span>/<span class="l">${p.losses}</span></span></td>
      <td class="num"><span class="bar" style="--v:${winRate(p)}%"></span>${winRate(p)}%</td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="empty">${query ? `Ninguém encontrado com “${escapeHTML(query)}”.` : 'Nenhuma partida registrada ainda. <a href="#jogar">Jogue a primeira!</a>'}</td></tr>`;

  const matches = scope === 'global' && matchFilter === 'mine' && me
    ? data.matches.filter(m => m.entries.some(e => e.user_id === me.id || (!e.bot && e.name === me.username)))
    : data.matches;
  $('#match-list').innerHTML = matches.length
    ? matches.map(m => matchCardHTML(m, { highlightId: scope === 'global' ? me?.id : null, highlightName: scope === 'global' ? me?.username : null })).join('')
    : `<li class="empty-card">${matchFilter === 'mine' ? 'Você ainda não tem partidas no ranking global.' : 'Sem partidas recentes.'}</li>`;
}

export function initRankingView() {
  $('#ranking-tabs').addEventListener('change', e => { scope = e.target.value; renderRanking(); });
  $('#ranking-search').addEventListener('input', fill);
  $('#match-filter').addEventListener('change', e => { matchFilter = e.target.value; fill(); });
  $('#ranking-body').addEventListener('click', e => {
    const row = e.target.closest('tr[data-user]');
    if (row && !e.target.closest('a')) location.hash = `#jogador/${row.dataset.user}`;
  });
  $('#btn-reset-ranking').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Apagar o ranking deste navegador?',
      message: 'As partidas salvas só neste navegador serão removidas. O ranking global não é afetado.',
      confirmText: 'Apagar', danger: true,
    });
    if (!ok) return;
    resetRanking();
    renderRanking();
    toast('Ranking deste navegador apagado.', 'ok');
  });
  onAuthChange(() => { if (!$('#view-ranking').hidden) renderRanking(); });
  $$('#ranking-tabs input').forEach(i => { i.checked = i.value === scope; });
}
