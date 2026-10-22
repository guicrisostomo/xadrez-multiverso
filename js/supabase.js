// Cliente Supabase carregado sob demanda (o site continua funcionando offline sem ele).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

let client = null;

export const supabaseEnabled = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

export function getSupabase() {
  if (!supabaseEnabled()) return Promise.reject(new Error('Supabase não configurado'));
  client ||= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }));
  return client;
}
