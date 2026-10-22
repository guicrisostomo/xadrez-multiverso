// Contas (Supabase Auth): cadastro com e-mail e senha, nome de usuário público,
// recuperação de senha e o botão de conta no topo da página.
import { getSupabase, supabaseEnabled } from './supabase.js';
import { $, escapeHTML, showModal, closeModal, toast } from './ui.js';

const USERNAME_RE = /^[\p{L}\p{N}_. -]{3,20}$/u;
const listeners = new Set();
let user = null; // { id, email, username }

export const currentUser = () => user;

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
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  if (/valid email|invalid email/i.test(msg)) return 'E-mail inválido.';
  if (/profiles_username_key|duplicate key/i.test(msg)) return 'Este nome de usuário já está em uso.';
  return msg;
}

async function loadProfile(session) {
  if (!session) { user = null; return emit(); }
  const sb = await getSupabase();
  const { data, error } = await sb.from('profiles').select('username').eq('id', session.user.id).maybeSingle();
  if (error) console.error(error);
  let username = data?.username;
  if (!username && !error) {
    // Perfil ausente (ex.: conta criada antes do gatilho existir): cria agora.
    username = (session.user.user_metadata?.username || session.user.email.split('@')[0]).slice(0, 20).padEnd(3, '_');
    const { error: insErr } = await sb.from('profiles').insert({ id: session.user.id, username });
    if (insErr) { console.error(insErr); username = null; }
  }
  user = { id: session.user.id, email: session.user.email, username: username || session.user.email };
  emit();
}

export async function initAuth() {
  renderAccountButton();
  if (!supabaseEnabled()) return;
  $('#account-btn').hidden = false;
  $('#account-btn').addEventListener('click', () => (user ? openAccount() : openLogin()));
  try {
    const sb = await getSupabase();
    let lastId;
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setTimeout(openNewPassword, 0);
      const id = session?.user.id ?? null;
      if (id === lastId && event !== 'USER_UPDATED') return;
      lastId = id;
      // Fora do callback para não travar o cliente (recomendação do supabase-js).
      setTimeout(() => loadProfile(session), 0);
    });
  } catch (err) {
    console.error('Não foi possível iniciar o login.', err);
  }
}

function renderAccountButton() {
  const btn = $('#account-btn');
  if (!btn) return;
  btn.innerHTML = user ? `👤 <span>${escapeHTML(user.username)}</span>` : 'Entrar';
  btn.classList.toggle('logged', !!user);
}

// ---------------------------------------------------------------- modais

function formModal(html, onSubmit) {
  const card = showModal(html);
  const form = card.querySelector('form');
  const status = card.querySelector('.form-status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.textContent = '';
    status.className = 'form-status';
    try {
      await onSubmit(new FormData(form), status, card);
    } catch (err) {
      status.textContent = translate(err);
      status.className = 'form-status bad';
    } finally {
      btn.disabled = false;
    }
  });
  card.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    ({ login: openLogin, signup: openSignup, forgot: openForgot })[a.dataset.go]();
  }));
  card.querySelector('[data-close]')?.addEventListener('click', closeModal);
  card.querySelector('input')?.focus();
  return card;
}

export function openLogin() {
  formModal(`
    <h2>Entrar</h2>
    <p class="muted">Com uma conta, suas partidas valem para o ranking global.</p>
    <form class="auth-form">
      <label>E-mail <input class="text-input" name="email" type="email" autocomplete="email" required></label>
      <label>Senha <input class="text-input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Entrar</button>
      <p class="auth-links"><a href="#" data-go="forgot">Esqueci a senha</a> · <a href="#" data-go="signup">Criar conta</a></p>
    </form>`, async (fd) => {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') });
    if (error) throw error;
    closeModal();
    toast('Bem-vindo de volta!');
  });
}

export function openSignup() {
  formModal(`
    <h2>Criar conta</h2>
    <form class="auth-form">
      <label>Nome de usuário <input class="text-input" name="username" maxlength="20" autocomplete="nickname" required>
        <small class="muted">3 a 20 caracteres. É o nome que aparece no ranking.</small></label>
      <label>E-mail <input class="text-input" name="email" type="email" autocomplete="email" required></label>
      <label>Senha <input class="text-input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Criar conta</button>
      <p class="auth-links">Já tem conta? <a href="#" data-go="login">Entrar</a></p>
    </form>`, async (fd, status, card) => {
    const username = fd.get('username').trim();
    if (!USERNAME_RE.test(username)) throw new Error('Use de 3 a 20 letras, números, espaço, ponto, hífen ou _.');
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
      toast(`Conta criada. Olá, ${username}!`);
    } else {
      card.innerHTML = `<h2>Confirme seu e-mail</h2>
        <p>Enviamos um link de confirmação para <strong>${escapeHTML(fd.get('email'))}</strong>. Abra o link neste navegador para entrar.</p>
        <div class="actions"><button class="btn" data-close>Ok</button></div>`;
      card.querySelector('[data-close]').addEventListener('click', closeModal);
    }
  });
}

async function usernameFree(sb, username, exceptId = null) {
  const pattern = username.replace(/[\\%_]/g, ch => `\\${ch}`);
  const { data, error } = await sb.from('profiles').select('id').ilike('username', pattern).limit(1);
  if (error) throw error;
  return !data.length || data[0].id === exceptId;
}

function openForgot() {
  formModal(`
    <h2>Recuperar senha</h2>
    <form class="auth-form">
      <label>E-mail da conta <input class="text-input" name="email" type="email" autocomplete="email" required></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Enviar link</button>
      <p class="auth-links"><a href="#" data-go="login">Voltar</a></p>
    </form>`, async (fd, status) => {
    const sb = await getSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(fd.get('email').trim(), { redirectTo: redirectTo() });
    if (error) throw error;
    status.textContent = 'Se o e-mail tiver conta, você vai receber um link para criar uma nova senha.';
    status.className = 'form-status ok';
  });
}

function openNewPassword() {
  formModal(`
    <h2>Nova senha</h2>
    <form class="auth-form">
      <label>Nova senha <input class="text-input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <p class="form-status" role="status"></p>
      <button class="btn" type="submit">Salvar senha</button>
    </form>`, async (fd) => {
    const sb = await getSupabase();
    const { error } = await sb.auth.updateUser({ password: fd.get('password') });
    if (error) throw error;
    closeModal();
    toast('Senha alterada!');
  });
}

function openAccount() {
  const card = formModal(`
    <h2>Minha conta</h2>
    <p class="muted">${escapeHTML(user.email)}</p>
    <form class="auth-form">
      <label>Nome de usuário <input class="text-input" name="username" maxlength="20" value="${escapeHTML(user.username)}" required></label>
      <p class="form-status" role="status"></p>
      <div class="actions">
        <button class="btn" type="submit">Salvar nome</button>
        <button class="btn ghost" type="button" data-a="logout">Sair da conta</button>
      </div>
    </form>`, async (fd, status) => {
    const username = fd.get('username').trim();
    if (username === user.username) return;
    if (!USERNAME_RE.test(username)) throw new Error('Use de 3 a 20 letras, números, espaço, ponto, hífen ou _.');
    const sb = await getSupabase();
    if (!(await usernameFree(sb, username, user.id))) throw new Error('Este nome de usuário já está em uso.');
    const { error } = await sb.from('profiles').update({ username }).eq('id', user.id);
    if (error) throw error;
    user = { ...user, username };
    emit();
    status.textContent = 'Nome atualizado.';
    status.className = 'form-status ok';
  });
  card.querySelector('[data-a=logout]').addEventListener('click', async () => {
    const sb = await getSupabase();
    await sb.auth.signOut();
    closeModal();
    toast('Você saiu da conta.');
  });
}
