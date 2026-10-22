// Utilitários de interface compartilhados: armazenamento, janelas (modais),
// confirmações e avisos. Nada aqui usa alert/confirm/prompt do navegador.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento indisponível */ }
  },
};

export function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------------------------------------------------------------- modal

let modalState = null; // { onClose, returnFocus, dismissible }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

// Abre uma janela sobre a página. Fecha com Esc, clique fora ou no ×
// (a menos que dismissible seja false). Devolve o cartão da janela.
export function showModal(html, { onClose = null, dismissible = true, label = '' } = {}) {
  const modal = $('#modal');
  const previous = modalState;
  modalState = { onClose, dismissible, returnFocus: previous?.returnFocus ?? document.activeElement };
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" ${label ? `aria-label="${escapeHTML(label)}"` : ''}>
    ${dismissible ? '<button class="modal-x" type="button" aria-label="Fechar" data-modal-close>×</button>' : ''}${html}</div>`;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const card = modal.firstElementChild;
  if (previous?.onClose) previous.onClose();
  requestAnimationFrame(() => {
    const target = card.querySelector('[autofocus]') || card.querySelector(`input, ${FOCUSABLE}`);
    (target && !target.matches('[data-modal-close]') ? target : card.querySelector(FOCUSABLE))?.focus();
  });
  return card;
}

export function closeModal() {
  const modal = $('#modal');
  if (modal.hidden) return;
  const state = modalState;
  modalState = null;
  modal.hidden = true;
  modal.innerHTML = '';
  document.body.classList.remove('modal-open');
  state?.onClose?.();
  if (state?.returnFocus?.isConnected) state.returnFocus.focus();
}

export function initModal() {
  const modal = $('#modal');
  modal.addEventListener('click', e => {
    if (!modalState?.dismissible) return;
    if (e.target === modal || e.target.closest('[data-modal-close]')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (modal.hidden) return;
    if (e.key === 'Escape' && modalState?.dismissible) { e.preventDefault(); closeModal(); }
    if (e.key === 'Tab') {
      // Mantém o foco dentro da janela.
      const items = $$(FOCUSABLE, modal).filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// Confirmação dentro da página. Resolve true/false.
export function confirmDialog({ title, message = '', confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    const answer = value => {
      if (answered) return;
      answered = true;
      closeModal();
      resolve(value);
    };
    const card = showModal(`
      <h2>${escapeHTML(title)}</h2>
      ${message ? `<p class="muted">${escapeHTML(message)}</p>` : ''}
      <div class="actions end">
        <button class="btn ghost" type="button" data-answer="no">${escapeHTML(cancelText)}</button>
        <button class="btn ${danger ? 'danger' : ''}" type="button" data-answer="yes" autofocus>${escapeHTML(confirmText)}</button>
      </div>`, { label: title, onClose: () => { if (!answered) { answered = true; resolve(false); } } });
    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-answer]');
      if (btn) answer(btn.dataset.answer === 'yes');
    });
  });
}

// ---------------------------------------------------------------- avisos

const TOAST_ICON = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '⛔' };

// Aviso discreto no canto da tela. type: info | ok | warn | error.
export function toast(text, type = 'info') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon" aria-hidden="true">${TOAST_ICON[type] || TOAST_ICON.info}</span><span>${escapeHTML(text)}</span>`;
  box.appendChild(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  const remove = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  const timer = setTimeout(remove, type === 'error' ? 6000 : 3200);
  t.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// "há 5 min", "ontem", "12/10/2026".
export function timeAgo(date) {
  const d = new Date(date);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ontem';
  if (s < 604800) return `há ${Math.floor(s / 86400)} dias`;
  return d.toLocaleDateString('pt-BR');
}

// Avatar: foto (quando houver) ou iniciais com cor estável derivada do nome.
export function avatarHTML(name, url = null, size = 'md') {
  const initials = String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  if (url) return `<img class="avatar ${size}" src="${escapeHTML(url)}" alt="" referrerpolicy="no-referrer">`;
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `<span class="avatar ${size}" style="--h:${h}" aria-hidden="true">${escapeHTML(initials)}</span>`;
}
