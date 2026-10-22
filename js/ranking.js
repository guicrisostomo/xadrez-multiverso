// Ranking Elo. O ranking global (Supabase) vale para partidas em que todos os
// humanos estão logados: cada conta envia o resultado por report_match e o Elo é
// calculado no servidor quando todas confirmam. As demais partidas ficam no
// ranking deste navegador (localStorage). Partidas com 3–4 jogadores são tratadas
// como vários confrontos par-a-par conforme a colocação final.
import { store } from './ui.js';
import { getSupabase, supabaseEnabled } from './supabase.js';

const KEY = 'xadrez.ranking.v1';
const START = 1200;
const BOT_RATING = 1200;

export function loadRanking() {
  return store.get(KEY, { players: {}, matches: [] });
}

export function resetRanking() {
  store.set(KEY, { players: {}, matches: [] });
}

const toMatch = m => ({ id: m.id, date: m.created_at, variant: m.variant, entries: m.entries });

export async function loadGlobalRanking() {
  const sb = await getSupabase();
  const [players, matches] = await Promise.all([
    sb.from('players').select('user_id, name, rating, games, wins, draws, losses').not('user_id', 'is', null).order('rating', { ascending: false }).limit(200),
    sb.from('matches').select('id, created_at, variant, entries').not('game_id', 'is', null).order('created_at', { ascending: false }).limit(40),
  ]);
  if (players.error) throw players.error;
  if (matches.error) throw matches.error;
  return { players: players.data, matches: matches.data.map(toMatch) };
}

// Perfil público de uma conta: nome, estatísticas, posição e partidas recentes.
export async function loadPlayerProfile(userId) {
  const sb = await getSupabase();
  const [profile, player] = await Promise.all([
    sb.from('profiles').select('id, username, created_at').eq('id', userId).maybeSingle(),
    sb.from('players').select('name, rating, games, wins, draws, losses').eq('user_id', userId).maybeSingle(),
  ]);
  if (profile.error) throw profile.error;
  if (player.error) throw player.error;
  if (!profile.data) return null;

  let position = null;
  if (player.data) {
    const above = await sb.from('players').select('id', { count: 'exact', head: true })
      .not('user_id', 'is', null).gt('rating', player.data.rating);
    if (!above.error) position = (above.count ?? 0) + 1;
  }

  // Partidas novas guardam o user_id; as mais antigas só o nome.
  const select = 'id, created_at, variant, entries';
  const [byId, byName] = await Promise.all([
    sb.from('matches').select(select).contains('entries', [{ user_id: userId }]).order('created_at', { ascending: false }).limit(30),
    sb.from('matches').select(select).not('game_id', 'is', null).contains('entries', [{ name: profile.data.username, bot: false }]).order('created_at', { ascending: false }).limit(30),
  ]);
  if (byId.error) throw byId.error;
  const seen = new Set();
  const matches = [...byId.data, ...(byName.error ? [] : byName.data)]
    .filter(m => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 30)
    .map(toMatch);

  return { profile: profile.data, stats: player.data, position, matches };
}

const norm = name => name.trim().toLowerCase();

// Envia o resultado de uma partida com contas para o ranking global.
// entries: [{ user_id, bot, rank }] na ordem dos jogadores (rank 1 = vencedor).
// Retorna { status: 'pending' | 'applied' | 'already', deltas?, confirmed?, needed? }.
export async function reportMatch(gameId, variantName, entries) {
  if (!supabaseEnabled()) throw new Error('Supabase não configurado');
  const sb = await getSupabase();
  const { data, error } = await sb.rpc('report_match', { p_game_id: gameId, p_variant: variantName, p_entries: entries });
  if (error) throw error;
  return data;
}

// Ranking deste navegador. entries: [{ name, bot, rank }] — rank 1 = vencedor.
// Retorna a variação de Elo de cada entrada.
export function recordLocal(variantName, entries) {
  const data = loadRanking();
  const rating = e => (e.bot ? BOT_RATING : data.players[norm(e.name)]?.rating ?? START);
  const before = entries.map(rating);
  const n = entries.length;
  const k = 32 / Math.max(1, n - 1);
  const allTied = entries.every(e => e.rank === entries[0].rank);

  const deltas = entries.map((e, i) => {
    if (e.bot) return 0;
    let d = 0;
    entries.forEach((o, j) => {
      if (i === j) return;
      const expected = 1 / (1 + 10 ** ((before[j] - before[i]) / 400));
      const score = e.rank < o.rank ? 1 : e.rank === o.rank ? 0.5 : 0;
      d += k * (score - expected);
    });
    return Math.round(d);
  });

  entries.forEach((e, i) => {
    if (e.bot) return;
    const id = norm(e.name);
    const p = data.players[id] || { name: e.name.trim(), rating: START, games: 0, wins: 0, draws: 0, losses: 0 };
    p.name = e.name.trim();
    p.rating += deltas[i];
    p.games++;
    if (allTied) p.draws++;
    else if (e.rank === 1) p.wins++;
    else p.losses++;
    data.players[id] = p;
  });

  data.matches.unshift({
    date: new Date().toISOString(),
    variant: variantName,
    entries: entries.map((e, i) => ({ name: e.name, bot: e.bot, rank: e.rank, delta: deltas[i] })),
  });
  data.matches = data.matches.slice(0, 30);
  store.set(KEY, data);
  return deltas;
}
