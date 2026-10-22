// Contas (Supabase Auth): e-mail e senha ou Google, nome de usuário público,
// recuperação de senha e o botão de conta no topo da página.
import { getSupabase, supabaseEnabled } from './supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { $, store, escapeHTML, showModal, closeModal, toast, avatarHTML } from './ui.js';

export const USERNAME_RE = /^[\p{L}\p{N}_. -]{3,20}$/u;
export const USERNAME_HELP = 'Use de 3 a 20 letras, números, espaço, ponto, hífen ou _.';

const listeners = new Set();
// { id, email, username, avatarUrl, provider, createdAt }
let user = null;
let ready = false;
let providers = null;

export const currentUser = () => user;
export const authReady = () => ready;

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  renderAccountButton();
  for (const fn of listeners) fn(user);
}

const redirectTo = () => `${location.origin}${location.pathname}`;

function translate(err) {
  const msg = err?.message || String(err);
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).';
  if (/already registered|already been registered/i.test(msg)) return 'Já existe uma conta com este e-mail.';
  if (/password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/should be different/i.test(msg)) return 'A nova senha precisa ser diferente da atual.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  if (/valid email|invalid email/i.test(msg)) return 'E-mail inválido.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'O login com Google ainda não está disponível.';
  if (/profiles_username_key|duplicate key/i.test(msg)) return 'Este nome de usuário já está em uso.';
  if (/failed to fetch|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet.';
  return msg;
}

// Provedores de login ativos no projeto (para só mostrar o Google se estiver ligado).
async function loadProviders() {
  if (providers) return providers;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const data = await res.json();
    providers = { google: !!data.external?.google, email: data.external?.email !== false };
  } catch {
    providers = { google: false, email: true };
  }
  return providers;
}

async function loadProfile(session) {
  if (!session) { user = null; ready = true; return emit(); }
  const sb = await getSupabase();
  const meta = session.user.user_metadata || {};
  const { data, error } = await sb.from('profiles').select('username, created_at').eq('id', session.user.id).maybeSingle();
  if (error) console.error(error);
  let username = data?.username;
  if (!username && !error) {
    // Perfil ausente (ex.: conta criada antes do gatilho existir): cria agora.
    username = (meta.username || meta.full_name || session.user.email.split('@')[0]).replace(/[^\p{L}\p{N}_. -]/gu, '').slice(0, 20).padEnd(3, '_');
    const { error: insErr } = await sb.from('profiles').insert({ id: session.user.id, username });
    if (insErr) { console.error(insErr); username = null; }
  }
  user = {
    id: session.user.id,
    email: session.user.email,
    username: username || session.user.email,
    avatarUrl: meta.avatar_url || meta.picture || null,
    provider: session.user.app_metadata?.provider || 'email',
    createdAt: data?.created_at || session.user.created_at,
  };
  ready = true;
  emit();
  maybeAskUsername(meta);
}

// Quem entra pelo Google ganha um nome automático; no primeiro acesso,
// oferece a chance de escolher outro.
function maybeAskUsername(meta) {
  const key = `xadrez.nomeEscolhido.${user.id}`;
  if (meta.username || store.get(key, false)) return;
  store.set(key, true);
  const card = showModal(`
    <div class="modal-head">${avatarHTML(user.username, user.avatarUrl, 'lg')}
      <div><h2>Bem-vindo!</h2><p class="muted">Como você quer aparecer no ranking?</p></div></div>
    <form class="auth-form">
      <label>Nome de usuário <input class="text-input" name="username" maxlength="20" value="${escapeHTML(user.username)}" required>
        <small class="muted">${USERNAME_HELP} Dá para trocar depois no seu perfil.</small></label>
      <p class="form-status" role="status"></p>
      <div class="actions end">
        <button class="btn ghost" type="button" data-modal-close>Manter este</button>
        <button class="btn" type="submit">Salvar nome</button>
      </div>
    </form>`, { label: 'Escolha seu nome' });
  bindForm(card, async fd => {
    await updateUsername(fd.get('username'));
    closeModal();
    toast(`Tudo certo, ${user.username}!`, 'ok');
  });
}

function cleanAuthParams() {
  const params = new URLSearchParams(location.search);
  const error = params.get('error_description') || params.get('error');
  if (!params.has('code') && !error) return;
  history.replaceState(history.state, '', `${location.pathname}${location.hash}`);
  if (error) toast(translate(new Error(error.replace(/\+/g, ' '))), 'error');
}

export async function initAuth() {
  renderAccountButton();
  if (!supabaseEnabled()) { ready = true; return; }
  $('#account-btn').hidden = false;
  $('#account-btn').addEventListener('click', () => {
    if (user) location.hash = '#perfil';
    else openLogin();
  });
  loadProviders();
  try {
    const sb = await getSupabase();
    let lastId;
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setTimeout(openNewPassword, 0);
      if (event === 'SIGNED_IN') setTimeout(cleanAuthParams, 0);
      const id = session?.user.id ?? null;
      if (id === lastId && event !== 'USER_UPDATED') return;
      lastId = id;
      // Fora do callback para não travar o cliente (recomendação do supabase-js).
      setTimeout(() => loadProfile(session), 0);
    });
    setTimeout(cleanAuthParams, 1500);
  } catch (err) {
    console.error('Não foi possível iniciar o login.', err);
    ready = true;
    emit();
  }
}

function renderAccountButton() {
  const btn = $('#account-btn');
  if (!btn) return;
  btn.innerHTML = user
    ? `${avatarHTML(user.username, user.avatarUrl, 'xs')}<span>${escapeHTML(user.username)}</span>`
    : 'Entrar';
  btn.classList.toggle('logged', !!user);
  btn.setAttribute('aria-label', user ? `Meu perfil (${user.username})` : 'Entrar na conta');
}

// ---------------------------------------------------------------- ações da conta

async function usernameFree(sb, username, exceptId = null) {
  const pattern = username.replace(/[\\%_]/g, ch => `\\${ch}`);
  const { data, error } = await sb.from('profiles').select('id').ilike('username', pattern).limit(1);
  if (error) throw error;
  return !data.length || data[0].id === exceptId;
}

export async function updateUsername(raw) {
  const username = String(raw).trim();
  if (username === user.username) return;
  if (!USERNAME_RE.test(username)) throw new Error(USERNAME_HELP);
  const sb = await getSupabase();
  if (!(await usernameFree(sb, username, user.id))) throw new Error('Este nome de usuário já está em uso.');
  const { error } = await sb.from('profiles').update({ username }).eq('id', user.id);
  if (error) throw new Error(translate(error));
  user = { ...user, username };
  emit();
}

export async function changePassword(password) {
  const sb = await getSupabase();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(translate(error));
}

export async function signOut() {
  const sb = await getSupabase();
  await sb.auth.signOut();
  toast('Você saiu da conta.', 'ok');
}

async function signInWithGoogle() {
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
  if (error) throw error;
}

// ---------------------------------------------------------------- formulários

// Liga o envio de um formulário dentro de um modal: desabilita o botão,
// mostra erros traduzidos no próprio formulário.
export function bindForm(root, onSubmit) {
  const form = root.querySelector('form');
  const status = form.querySelector('.form-status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.classList.add('loading');
    status.textContent = '';
    status.className = 'form-status';
    try {
      await onSubmit(new FormData(form), status, root);
    } catch (err) {
      status.textContent = translate(err);
      status.className = 'form-status bad';
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
}

const GOOGLE_ICON = `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function socialBlock() {
  return `<div class="social" data-social hidden>
      <button class="btn google" type="button" data-google>${GOOGLE_ICON}<span>Continuar com Google</span></button>
      <div class="divider"><span>ou com e-mail</span></div>
    </div>`;
}

function setupAuthModal(card, onSubmit) {
  bindForm(card, onSubmit);
  card.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    ({ login: openLogin, signup: openSignup, forgot: openForgot })[a.dataset.go]();
  }));
  const social = card.querySelector('[data-social]');
  if (social) {
    loadProviders().then(p => { social.hidden = !p.google; });
    card.querySelector('[data-google]').addEventListener('click', async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.classList.add('loading');
      try { await signInWithGoogle(); } catch (err) {
        const status = card.querySelector('.form-status');
        status.textContent = translate(err);
        status.className = 'form-status bad';
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    });
  }
}

export function openLogin(reason = '') {
  const card = showModal(`
    <h2>Entrar</h2>
    <p class="muted">${escapeHTML(reason || 'Com uma conta, suas partidas valem para o ranking global.')}</p>
    ${socialBlock()}
    <form class="auth-form">
      <label>E-mail <input class="text-input" name="email" type="email" autocomplete="email" required></label>
      <label>Senha <input class="text-input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Entrar</button>
      <p class="auth-links"><a href="#" data-go="forgot">Esqueci a senha</a> · <a href="#" data-go="signup">Criar conta</a></p>
    </form>`, { label: 'Entrar' });
  setupAuthModal(card, async fd => {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') });
    if (error) throw error;
    closeModal();
    toast('Bem-vindo de volta!', 'ok');
  });
}

export function openSignup() {
  const card = showModal(`
    <h2>Criar conta</h2>
    ${socialBlock()}
    <form class="auth-form">
      <label>Nome de usuário <input class="text-input" name="username" maxlength="20" autocomplete="nickname" required>
        <small class="muted">3 a 20 caracteres. É o nome que aparece no ranking.</small></label>
      <label>E-mail <input class="text-input" name="email" type="email" autocomplete="email" required></label>
      <label>Senha <input class="text-input" name="password" type="password" minlength="6" autocomplete="new-password" required>
        <small class="muted">Pelo menos 6 caracteres.</small></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Criar conta</button>
      <p class="auth-links">Já tem conta? <a href="#" data-go="login">Entrar</a></p>
    </form>`, { label: 'Criar conta' });
  setupAuthModal(card, async (fd, status, root) => {
    const username = fd.get('username').trim();
    if (!USERNAME_RE.test(username)) throw new Error(USERNAME_HELP);
    const sb = await getSupabase();
    if (!(await usernameFree(sb, username))) throw new Error('Este nome de usuário já está em uso.');
    const { data, error } = await sb.auth.signUp({
      email: fd.get('email').trim(),
      password: fd.get('password'),
      options: { data: { username }, emailRedirectTo: redirectTo() },
    });
    if (error) throw error;
    if (data.session) {
      closeModal();
      toast(`Conta criada. Olá, ${username}!`, 'ok');
    } else {
      root.innerHTML = `<button class="modal-x" type="button" aria-label="Fechar" data-modal-close>×</button>
        <div class="big-icon" aria-hidden="true">📬</div>
        <h2>Confirme seu e-mail</h2>
        <p>Enviamos um link de confirmação para <strong>${escapeHTML(fd.get('email'))}</strong>.</p>
        <p class="muted">Abra o link neste mesmo navegador para entrar. Não chegou? Veja a caixa de spam.</p>
        <div class="actions end"><button class="btn" type="button" data-modal-close>Entendi</button></div>`;
    }
  });
}

function openForgot() {
  const card = showModal(`
    <h2>Recuperar senha</h2>
    <p class="muted">Vamos enviar um link para você criar uma nova senha.</p>
    <form class="auth-form">
      <label>E-mail da conta <input class="text-input" name="email" type="email" autocomplete="email" required></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Enviar link</button>
      <p class="auth-links"><a href="#" data-go="login">Voltar para o login</a></p>
    </form>`, { label: 'Recuperar senha' });
  setupAuthModal(card, async (fd, status) => {
    const sb = await getSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(fd.get('email').trim(), { redirectTo: redirectTo() });
    if (error) throw error;
    status.textContent = 'Se o e-mail tiver conta, você vai receber o link em instantes.';
    status.className = 'form-status ok';
  });
}

function openNewPassword() {
  const card = showModal(`
    <h2>Nova senha</h2>
    <form class="auth-form">
      <label>Nova senha <input class="text-input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Salvar senha</button>
    </form>`, { label: 'Nova senha', dismissible: false });
  bindForm(card, async fd => {
    await changePassword(fd.get('password'));
    closeModal();
    toast('Senha alterada!', 'ok');
  });
}
