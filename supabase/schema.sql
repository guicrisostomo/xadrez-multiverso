-- Banco do Xadrez Multiverso: contas, ranking global e histórico de partidas.
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute. Ele pode ser
-- executado de novo sem problemas (inclusive sobre a versão anterior, sem contas).
--
-- Regras:
--  * Toda a leitura é pública; nenhuma tabela aceita escrita direta do site,
--    exceto o próprio usuário trocando o nome no seu perfil.
--  * Só valem para o ranking partidas em que todos os humanos estão logados.
--    Cada conta envia o resultado por report_match; o Elo só é aplicado quando
--    todas as contas da partida enviaram exatamente o mesmo resultado.

-- ---------------------------------------------------------------- perfis

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 3 and 20 and username = btrim(username)),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

alter table public.profiles enable row level security;
grant select on public.profiles to anon, authenticated;
grant insert (id, username), update (username) on public.profiles to authenticated;

drop policy if exists "perfis publicos" on public.profiles;
create policy "perfis publicos" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "cria o proprio perfil" on public.profiles;
create policy "cria o proprio perfil" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "edita o proprio perfil" on public.profiles;
create policy "edita o proprio perfil" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Cria o perfil ao cadastrar, usando o nome escolhido (com sufixo se já existir).
-- No login com Google não há nome de usuário: usa o nome da conta Google ou o e-mail.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text := left(btrim(regexp_replace(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  ), '[^[:alnum:]_ .-]', '', 'g')), 15);
  candidate text;
begin
  if char_length(base) < 3 then base := 'jogador'; end if;
  candidate := base;
  for attempt in 1..8 loop
    begin
      insert into profiles (id, username) values (new.id, candidate);
      return new;
    exception when unique_violation then
      candidate := base || '_' || (1000 + floor(random() * 9000))::int;
    end;
  end loop;
  raise exception 'não foi possível criar o perfil';
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- ranking

create table if not exists public.players (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 20),
  name_key text generated always as (lower(btrim(name))) stored,
  rating integer not null default 1200,
  games integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  updated_at timestamptz not null default now()
);
-- Versão anterior: o ranking era por nome. Agora é por conta.
alter table public.players drop constraint if exists players_name_key_key;
alter table public.players add column if not exists user_id uuid unique references auth.users (id) on delete cascade;

create table if not exists public.matches (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  variant text not null check (char_length(variant) <= 40),
  entries jsonb not null
);
alter table public.matches add column if not exists game_id uuid unique;

-- Resultados enviados por cada conta, aguardando a confirmação das demais.
create table if not exists public.match_reports (
  game_id uuid not null,
  reporter uuid not null references auth.users (id) on delete cascade,
  variant text not null,
  entries jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, reporter)
);

create index if not exists players_rating_idx on public.players (rating desc);
create index if not exists matches_created_idx on public.matches (created_at desc);
-- Busca das partidas de um jogador (entries @> '[{"user_id": ...}]').
create index if not exists matches_entries_idx on public.matches using gin (entries jsonb_path_ops);

grant select on public.players, public.matches to anon, authenticated;
revoke all on public.match_reports from anon, authenticated;

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_reports enable row level security;

drop policy if exists "ranking publico" on public.players;
create policy "ranking publico" on public.players for select to anon, authenticated using (true);
drop policy if exists "partidas publicas" on public.matches;
create policy "partidas publicas" on public.matches for select to anon, authenticated using (true);

-- Mantém o nome do ranking igual ao nome do perfil.
create or replace function public.sync_player_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update players set name = new.username where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists on_profile_renamed on public.profiles;
create trigger on_profile_renamed after update of username on public.profiles
  for each row execute function public.sync_player_name();

-- A função antiga aceitava resultados sem login; não é mais usada.
drop function if exists public.record_match(text, jsonb);

-- p_entries: [{ "user_id": "<uuid>" | null, "bot": false, "rank": 1 }, ...] (rank 1 = vencedor),
-- na ordem dos jogadores da partida. Computadores têm user_id null e bot true.
-- Retorna { status: 'pending' | 'applied' | 'already', confirmed, needed, deltas }.
create or replace function public.report_match(p_game_id uuid, p_variant text, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n int;
  i int;
  j int;
  k numeric;
  r numeric;
  total numeric;
  expected numeric;
  score numeric;
  all_tied boolean;
  needed int := 0;
  agreeing int;
  uids uuid[] := '{}';
  bots boolean[] := '{}';
  ranks int[] := '{}';
  ratings numeric[] := '{}';
  deltas int[] := '{}';
  canonical jsonb := '[]'::jsonb;
  stored jsonb := '[]'::jsonb;
  existing jsonb;
  match_id bigint;
  uname text;
begin
  if me is null then
    raise exception 'entre na sua conta para registrar partidas';
  end if;
  if p_game_id is null or p_variant is null or char_length(p_variant) > 40 then
    raise exception 'partida inválida';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entradas inválidas';
  end if;
  n := jsonb_array_length(p_entries);
  if n < 2 or n > 4 then
    raise exception 'uma partida tem de 2 a 4 jogadores';
  end if;

  -- Uma chamada por vez para cada partida, para a contagem de confirmações ser exata.
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text, 0));

  select m.entries into existing from matches m where m.game_id = p_game_id;
  if found then
    return jsonb_build_object('status', 'already',
      'deltas', (select jsonb_agg((e ->> 'delta')::int) from jsonb_array_elements(existing) e));
  end if;

  for i in 1..n loop
    bots[i] := coalesce((p_entries -> (i - 1) ->> 'bot')::boolean, false);
    uids[i] := nullif(p_entries -> (i - 1) ->> 'user_id', '')::uuid;
    ranks[i] := (p_entries -> (i - 1) ->> 'rank')::int;
    if ranks[i] is null or ranks[i] < 1 or ranks[i] > n then
      raise exception 'colocação inválida';
    end if;
    if bots[i] and uids[i] is not null then
      raise exception 'computador não tem conta';
    end if;
    if not bots[i] then
      if uids[i] is null then
        raise exception 'todos os jogadores humanos precisam estar logados';
      end if;
      if not exists (select 1 from profiles p where p.id = uids[i]) then
        raise exception 'conta desconhecida';
      end if;
      for j in 1..i - 1 loop
        if uids[j] = uids[i] then raise exception 'conta repetida na partida'; end if;
      end loop;
      needed := needed + 1;
    end if;
    canonical := canonical || jsonb_build_object('user_id', uids[i], 'bot', bots[i], 'rank', ranks[i]);
  end loop;

  if not (me = any (uids)) then
    raise exception 'você não participou desta partida';
  end if;

  insert into match_reports (game_id, reporter, variant, entries)
  values (p_game_id, me, p_variant, canonical)
  on conflict (game_id, reporter) do update set entries = excluded.entries, variant = excluded.variant, created_at = now();

  select count(*) into agreeing from match_reports mr
  where mr.game_id = p_game_id and mr.entries = canonical and mr.reporter = any (uids);
  if agreeing < needed then
    return jsonb_build_object('status', 'pending', 'confirmed', agreeing, 'needed', needed);
  end if;

  -- Todas as contas confirmaram: calcula o Elo.
  for i in 1..n loop
    r := null;
    if not bots[i] then
      select pl.rating into r from players pl where pl.user_id = uids[i];
    end if;
    ratings[i] := coalesce(r, 1200);
  end loop;

  k := 32.0 / (n - 1);
  all_tied := (select count(distinct x) from unnest(ranks) as x) = 1;

  for i in 1..n loop
    total := 0;
    if not bots[i] then
      for j in 1..n loop
        if i <> j then
          expected := 1 / (1 + power(10, (ratings[j] - ratings[i]) / 400));
          score := case when ranks[i] < ranks[j] then 1 when ranks[i] = ranks[j] then 0.5 else 0 end;
          total := total + k * (score - expected);
        end if;
      end loop;
    end if;
    deltas[i] := round(total);
  end loop;

  for i in 1..n loop
    uname := 'Computador';
    if not bots[i] then
      select p.username into uname from profiles p where p.id = uids[i];
      insert into players as pl (user_id, name, rating, games, wins, draws, losses)
      values (
        uids[i], uname, 1200 + deltas[i], 1,
        case when not all_tied and ranks[i] = 1 then 1 else 0 end,
        case when all_tied then 1 else 0 end,
        case when not all_tied and ranks[i] > 1 then 1 else 0 end
      )
      on conflict (user_id) do update set
        name = excluded.name,
        rating = pl.rating + deltas[i],
        games = pl.games + 1,
        wins = pl.wins + excluded.wins,
        draws = pl.draws + excluded.draws,
        losses = pl.losses + excluded.losses,
        updated_at = now();
    end if;
    stored := stored || jsonb_build_object('user_id', uids[i], 'name', uname, 'bot', bots[i], 'rank', ranks[i], 'delta', deltas[i]);
  end loop;

  insert into matches (game_id, variant, entries) values (p_game_id, p_variant, stored) returning id into match_id;
  delete from match_reports where game_id = p_game_id;
  -- Limpa confirmações abandonadas há mais de 7 dias.
  delete from match_reports where created_at < now() - interval '7 days';
  return jsonb_build_object('status', 'applied', 'deltas', to_jsonb(deltas));
end;
$$;

revoke all on function public.report_match(uuid, text, jsonb) from public, anon;
grant execute on function public.report_match(uuid, text, jsonb) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_player_name() from public, anon, authenticated;
