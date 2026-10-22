-- Ranking global do Xadrez Multiverso.
-- Cole este arquivo no SQL Editor do Supabase e execute (pode rodar de novo sem problemas).
--
-- As tabelas são somente leitura para o público: a única forma de alterar o
-- ranking é a função record_match, que valida a partida e calcula o Elo no servidor.

create table if not exists public.players (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 20),
  name_key text generated always as (lower(btrim(name))) stored unique,
  rating integer not null default 1200,
  games integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  variant text not null check (char_length(variant) <= 40),
  entries jsonb not null
);

create index if not exists players_rating_idx on public.players (rating desc);
create index if not exists matches_created_idx on public.matches (created_at desc);

grant select on public.players, public.matches to anon, authenticated;

alter table public.players enable row level security;
alter table public.matches enable row level security;

drop policy if exists "ranking publico" on public.players;
create policy "ranking publico" on public.players for select to anon, authenticated using (true);
drop policy if exists "partidas publicas" on public.matches;
create policy "partidas publicas" on public.matches for select to anon, authenticated using (true);

-- p_entries: [{ "name": "Ana", "bot": false, "rank": 1 }, ...]  (rank 1 = vencedor)
-- Retorna a variação de Elo de cada jogador, na mesma ordem.
create or replace function public.record_match(p_variant text, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  i int;
  j int;
  k numeric;
  r numeric;
  total numeric;
  expected numeric;
  score numeric;
  all_tied boolean;
  names text[] := '{}';
  bots boolean[] := '{}';
  ranks int[] := '{}';
  ratings numeric[] := '{}';
  deltas int[] := '{}';
  stored jsonb := '[]'::jsonb;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entradas inválidas';
  end if;
  n := jsonb_array_length(p_entries);
  if n < 2 or n > 4 then
    raise exception 'uma partida tem de 2 a 4 jogadores';
  end if;
  if p_variant is null or char_length(p_variant) > 40 then
    raise exception 'variante inválida';
  end if;

  for i in 1..n loop
    names[i] := btrim(coalesce(p_entries -> (i - 1) ->> 'name', ''));
    bots[i] := coalesce((p_entries -> (i - 1) ->> 'bot')::boolean, false);
    ranks[i] := (p_entries -> (i - 1) ->> 'rank')::int;
    if ranks[i] is null or ranks[i] < 1 or ranks[i] > n then
      raise exception 'colocação inválida';
    end if;
    if char_length(names[i]) not between 1 and 20 then
      raise exception 'nome inválido';
    end if;
    r := null;
    if not bots[i] then
      for j in 1..i - 1 loop
        if not bots[j] and lower(names[j]) = lower(names[i]) then
          raise exception 'nomes repetidos na mesma partida';
        end if;
      end loop;
      select p.rating into r from players p where p.name_key = lower(names[i]);
    end if;
    ratings[i] := coalesce(r, 1200);
  end loop;

  if not (false = any (bots)) then
    raise exception 'a partida precisa de pelo menos um jogador humano';
  end if;

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
    if not bots[i] then
      insert into players as p (name, rating, games, wins, draws, losses)
      values (
        names[i], 1200 + deltas[i], 1,
        case when not all_tied and ranks[i] = 1 then 1 else 0 end,
        case when all_tied then 1 else 0 end,
        case when not all_tied and ranks[i] > 1 then 1 else 0 end
      )
      on conflict (name_key) do update set
        name = excluded.name,
        rating = p.rating + deltas[i],
        games = p.games + 1,
        wins = p.wins + excluded.wins,
        draws = p.draws + excluded.draws,
        losses = p.losses + excluded.losses,
        updated_at = now();
    end if;
    stored := stored || jsonb_build_object('name', names[i], 'bot', bots[i], 'rank', ranks[i], 'delta', deltas[i]);
  end loop;

  insert into matches (variant, entries) values (p_variant, stored);
  return to_jsonb(deltas);
end;
$$;

revoke all on function public.record_match(text, jsonb) from public;
grant execute on function public.record_match(text, jsonb) to anon, authenticated;
