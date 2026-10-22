// Página de perfil: a sua (#perfil, com edição de nome, senha e saída da conta)
// e a pública de qualquer jogador (#jogador/<id>), com estatísticas, evolução
// do Elo e partidas recentes.
import { loadPlayerProfile } from './ranking.js';
import { matchCardHTML } from './ranking-view.js';
import { currentUser, authReady, onAuthChange, openLogin, openSignup, updateUsername, changePassword, signOut, bindForm, USERNAME_HELP } from './auth.js';
import { $, escapeHTML, confirmDialog, toast, avatarHTML } from './ui.js';

let shown = null; // id do perfil na tela ('me' ou user_id)
let request = 0;

const root = () => $('#profile-root');

export function showProfile(target) {
  shown = target;
  render();
}

export function initProfile() {
  let lastId = currentUser()?.id ?? null;
  onAuthChange(user => {
    const id = user?.id ?? null;
    const visible = shown && !$('#view-profile').hidden;
    if (id !== lastId) {
      // Entrou ou saiu da conta: o perfil muda por completo.
      lastId = id;
      if (visible) render();
    } else if (visible && user && (shown === 'me' || shown === user.id)) {
      // Só o nome mudou: atualiza o cabeçalho sem apagar formulários abertos.
      const h1 = root().querySelector('.profile-head h1');
      if (h1) h1.textContent = user.username;
    }
  });
}

function loginPrompt() {
  root().innerHTML = `
    <div class="empty-state">
      <div class="big-icon" aria-hidden="true">👤</div>
      <h1>Seu perfil</h1>
      <p class="muted">Entre na sua conta para ver suas estatísticas, sua posição no ranking e suas partidas.</p>
      <div class="actions center">
        <button class="btn" type="button" data-a="login">Entrar</button>
        <button class="btn ghost" type="button" data-a="signup">Criar conta</button>
      </div>
    </div>`;
  root().querySelector('[data-a=login]').addEventListener('click', () => openLogin());
  root().querySelector('[data-a=signup]').addEventListener('click', () => openSignup());
}

function skeleton() {
  root().innerHTML = `
    <div class="profile-head card skeleton-block"><span class="avatar xl"></span><div><span class="sk-line w40"></span><span class="sk-line w25"></span></div></div>
    <div class="stat-grid">${'<div class="stat card skeleton-block"><span class="sk-line w60"></span><span class="sk-line w40"></span></div>'.repeat(4)}</div>`;
}

async function render() {
  const me = currentUser();
  const own = shown === 'me' || (me && shown === me.id);
  if (shown === 'me' && !me) {
    if (!authReady()) return skeleton();
    return loginPrompt();
  }
  const userId = own ? me.id : shown;
  const req = ++request;
  skeleton();
  let info;
  try {
    info = await loadPlayerProfile(userId);
  } catch (err) {
    console.error(err);
    if (req !== request) return;
    root().innerHTML = `<div class="empty-state"><div class="big-icon">⚠️</div><h1>Não foi possível carregar o perfil</h1>
      <p class="muted">Verifique sua conexão e tente de novo.</p>
      <div class="actions center"><button class="btn" type="button" data-retry>Tentar de novo</button></div></div>`;
    root().querySelector('[data-retry]').addEventListener('click', render);
    return;
  }
  if (req !== request) return;
  if (!info) {
    root().innerHTML = `<div class="empty-state"><div class="big-icon">🔍</div><h1>Jogador não encontrado</h1>
      <div class="actions center"><a class="btn" href="#ranking">Ver o ranking</a></div></div>`;
    return;
  }
  draw(info, own ? me : null);
}

// Reconstrói a evolução do Elo a partir das variações das partidas recentes.
function ratingSeries(info, userId) {
  if (!info.stats) return [];
  const deltas = [];
  for (const m of info.matches) {
    const e = m.entries.find(x => x.user_id === userId || (!x.bot && x.name === info.profile.username));
    if (e && typeof e.delta === 'number') deltas.push(e.delta);
  }
  const series = [info.stats.rating];
  for (const d of deltas) series.push(series.at(-1) - d);
  return series.reverse();
}

function sparkline(series) {
  if (series.length < 2) return '<p class="muted small">O gráfico aparece depois de algumas partidas no ranking.</p>';
  const w = 560, h = 120, pad = 10;
  const min = Math.min(...series), max = Math.max(...series);
  const span = Math.max(max - min, 20);
  const x = i => pad + (i * (w - pad * 2)) / (series.length - 1);
  const y = v => h - pad - ((v - min) * (h - pad * 2)) / span;
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = series.at(-1);
  const diff = last - series[0];
  return `<div class="spark-head"><span class="muted small">Últimas ${series.length - 1} partidas</span>
      <span class="delta ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff}</span></div>
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Evolução do Elo de ${series[0]} para ${last}">
      <polyline class="spark-area" points="${x(0)},${h} ${pts} ${x(series.length - 1)},${h}"/>
      <polyline class="spark-line" points="${pts}"/>
      <circle class="spark-dot" cx="${x(series.length - 1)}" cy="${y(last)}" r="4"/>
    </svg>
    <div class="spark-scale muted small"><span>${min}</span><span>${max}</span></div>`;
}

function draw(info, me) {
  const { profile, stats, position, matches } = info;
  const s = stats || { rating: 1200, games: 0, wins: 0, draws: 0, losses: 0 };
  const rate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
  const since = new Date(profile.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const providerBadge = me ? `<span class="chip small">${me.provider === 'google' ? 'Conta Google' : 'E-mail e senha'}</span>` : '';

  root().innerHTML = `
    <div class="profile-head card">
      ${avatarHTML(profile.username, me?.avatarUrl, 'xl')}
      <div class="ph-text">
        <h1>${escapeHTML(profile.username)}</h1>
        <p class="muted">Jogador desde ${since} ${providerBadge}</p>
        ${me ? `<p class="muted small">${escapeHTML(me.email)}</p>` : ''}
      </div>
      ${me ? '' : '<a class="btn ghost small" href="#ranking">← Ranking</a>'}
    </div>

    <div class="stat-grid">
      <div class="stat card"><span class="stat-label">Elo</span><strong class="stat-value">${s.rating}</strong></div>
      <div class="stat card"><span class="stat-label">Posição</span><strong class="stat-value">${position ? `${position}º` : '—'}</strong></div>
      <div class="stat card"><span class="stat-label">Partidas</span><strong class="stat-value">${s.games}</strong>
        <span class="wdl small"><span class="w">${s.wins} V</span> · <span class="d">${s.draws} E</span> · <span class="l">${s.losses} D</span></span></div>
      <div class="stat card"><span class="stat-label">Vitórias</span><strong class="stat-value">${rate}%</strong><span class="bar wide" style="--v:${rate}%"></span></div>
    </div>

    <div class="profile-grid">
      <section class="card">
        <h2>Evolução do Elo</h2>
        ${sparkline(ratingSeries(info, profile.id))}
      </section>
      ${me ? settingsHTML(me) : ''}
    </div>

    <section>
      <h2 class="section-title">Partidas recentes</h2>
      <ul class="match-list">${matches.length
        ? matches.map(m => matchCardHTML(m, { highlightId: profile.id, highlightName: profile.username })).join('')
        : `<li class="empty-card">${me ? 'Você ainda não jogou partidas valendo ranking. <a href="#jogar">Jogar agora</a>' : 'Nenhuma partida no ranking ainda.'}</li>`}</ul>
    </section>`;

  if (me) bindSettings(me);
}

function settingsHTML(me) {
  return `
    <section class="card settings">
      <h2>Configurações da conta</h2>
      <form class="auth-form" data-form="name">
        <label>Nome de usuário
          <span class="inline-field">
            <input class="text-input" name="username" maxlength="20" value="${escapeHTML(me.username)}" required>
            <button class="btn small" type="submit">Salvar</button>
          </span>
          <small class="muted">${USERNAME_HELP}</small>
        </label>
        <p class="form-status" role="status"></p>
      </form>
      ${me.provider === 'email' ? `
      <details class="disclosure">
        <summary>Trocar senha</summary>
        <form class="auth-form" data-form="password">
          <label>Nova senha <input class="text-input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
          <label>Repita a nova senha <input class="text-input" name="confirm" type="password" minlength="6" autocomplete="new-password" required></label>
          <p class="form-status" role="status"></p>
          <button class="btn small" type="submit">Trocar senha</button>
        </form>
      </details>` : '<p class="muted small">Você entra com sua conta Google; a senha é gerenciada pelo Google.</p>'}
      <div class="actions"><button class="btn ghost small" type="button" data-a="logout">Sair da conta</button></div>
    </section>`;
}

function bindSettings() {
  const nameWrap = document.createElement('div');
  const nameForm = root().querySelector('[data-form=name]');
  nameForm.replaceWith(nameWrap);
  nameWrap.appendChild(nameForm);
  bindForm(nameWrap, async (fd, status) => {
    await updateUsername(fd.get('username'));
    status.textContent = 'Nome atualizado.';
    status.className = 'form-status ok';
    toast('Nome de usuário atualizado.', 'ok');
  });

  const pwForm = root().querySelector('[data-form=password]');
  if (pwForm) {
    const wrap = document.createElement('div');
    pwForm.replaceWith(wrap);
    wrap.appendChild(pwForm);
    bindForm(wrap, async (fd, status) => {
      if (fd.get('password') !== fd.get('confirm')) throw new Error('As senhas não são iguais.');
      await changePassword(fd.get('password'));
      pwForm.reset();
      status.textContent = 'Senha alterada.';
      status.className = 'form-status ok';
      toast('Senha alterada.', 'ok');
    });
  }

  root().querySelector('[data-a=logout]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Sair da conta?', message: 'Você pode entrar de novo quando quiser.', confirmText: 'Sair' });
    if (!ok) return;
    await signOut();
    location.hash = '#jogar';
  });
}
