// Cliente Supabase carregado sob demanda (o site continua funcionando offline sem ele).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

let client = null;

export const supabaseEnabled = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

export function getSupabase() {
  if (!supabaseEnabled()) return Promise.reject(new Error('Supabase não configurado'));
  // PKCE: os links de confirmação e de nova senha voltam com ?code=…, sem
  // conflitar com as rotas do site, que usam o #.
  client ||= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } }));
  return client;
}
