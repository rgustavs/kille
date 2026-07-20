-- ═══════════════════════════════════════════════════════════════════════════
-- Kille — Central gruppdatabas (Supabase / PostgreSQL)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Kör hela den här filen i Supabase SQL Editor (eller `supabase db` / psql med
-- POSTGRES_URL_NON_POOLING) för att sätta upp den centrala speldatabasen.
--
-- Säkerhetsmodell
-- ---------------
-- Appen är en statisk klient och använder därför den PUBLIKA anon-nyckeln. Den
-- får ALDRIG innehålla service_role- eller secret-nyckeln.
--
-- Alla tabeller har Row Level Security påslaget UTAN policys för anon, vilket
-- gör att anon-rollen inte kan läsa eller skriva tabellerna direkt. All åtkomst
-- går via SECURITY DEFINER-funktioner nedan som kräver att man känner till
-- gruppens `join_code` (delas med medlemmar) och, för admin-åtgärder, gruppens
-- `admin_code` (hemlig, sätts av den som skapar gruppen). Detta ger en rimlig
-- skyddsnivå för ett sällskapsspel utan att kräva e-postinloggning.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── Tabeller ────────────────────────────────────────────────────────────────

create table if not exists public.kille_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  join_code       text not null unique,
  admin_code_hash text not null,
  created_at      timestamptz not null default now()
);

create table if not exists public.kille_group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.kille_groups(id) on delete cascade,
  name       text not null,
  role       text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  unique (group_id, lower(name))
);

create table if not exists public.kille_group_players (
  id         text not null,
  group_id   uuid not null references public.kille_groups(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, id)
);

create table if not exists public.kille_group_games (
  id         text not null,
  group_id   uuid not null references public.kille_groups(id) on delete cascade,
  data       jsonb not null,
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, id)
);

-- ─── Row Level Security (deny-all för anon; åtkomst via RPC nedan) ────────────

alter table public.kille_groups          enable row level security;
alter table public.kille_group_members   enable row level security;
alter table public.kille_group_players   enable row level security;
alter table public.kille_group_games     enable row level security;

revoke all on public.kille_groups        from anon, authenticated;
revoke all on public.kille_group_members from anon, authenticated;
revoke all on public.kille_group_players from anon, authenticated;
revoke all on public.kille_group_games   from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Interna hjälpfunktioner
-- ═══════════════════════════════════════════════════════════════════════════

-- Verifierar join_code och returnerar gruppraden, annars fel.
create or replace function public._kille_group_by_code(p_group_id uuid, p_join_code text)
returns public.kille_groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.kille_groups;
begin
  select * into g
  from public.kille_groups
  where id = p_group_id
    and upper(join_code) = upper(trim(coalesce(p_join_code, '')));
  if not found then
    raise exception 'INVALID_GROUP_OR_CODE' using errcode = '28000';
  end if;
  return g;
end;
$$;

-- Kräver giltig admin_code för gruppen, annars fel.
create or replace function public._kille_require_admin(p_group_id uuid, p_join_code text, p_admin_code text)
returns public.kille_groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.kille_groups;
begin
  g := public._kille_group_by_code(p_group_id, p_join_code);
  if g.admin_code_hash is null
     or g.admin_code_hash <> crypt(coalesce(p_admin_code, ''), g.admin_code_hash) then
    raise exception 'INVALID_ADMIN_CODE' using errcode = '28000';
  end if;
  return g;
end;
$$;

-- Genererar en unik, läsbar join-kod (undviker lätt förväxlade tecken).
create or replace function public._kille_generate_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.kille_groups where join_code = code);
  end loop;
  return code;
end;
$$;

-- Bygger en komplett ögonblicksbild av en grupp (för login/pull).
create or replace function public._kille_snapshot(p_group_id uuid, p_role text default 'member')
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'group', (
      select jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'joinCode', g.join_code,
        'createdAt', g.created_at
      )
      from public.kille_groups g where g.id = p_group_id
    ),
    'role', p_role,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'role', m.role, 'createdAt', m.created_at
      ) order by m.role desc, m.created_at)
      from public.kille_group_members m where m.group_id = p_group_id
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'createdAt', p.created_at
      ) order by p.created_at)
      from public.kille_group_players p where p.group_id = p_group_id
    ), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(gm.data order by gm.created_at)
      from public.kille_group_games gm where gm.group_id = p_group_id
    ), '[]'::jsonb)
  );
$$;

-- Upsertar en medlem (unikt namn per grupp) och returnerar rollen.
create or replace function public._kille_upsert_member(p_group_id uuid, p_name text, p_role text default 'member')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_role text;
begin
  if v_name is null then
    return null;
  end if;
  insert into public.kille_group_members (group_id, name, role)
  values (p_group_id, v_name, p_role)
  on conflict (group_id, lower(name))
  do update set role = case when public.kille_group_members.role = 'admin'
                            then 'admin' else excluded.role end
  returning role into v_role;
  return v_role;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Publika RPC-funktioner (anropas av klienten med anon-nyckeln)
-- ═══════════════════════════════════════════════════════════════════════════

-- Skapa en ny grupp. Den som skapar blir admin och sätter en hemlig admin-kod.
create or replace function public.kille_create_group(
  p_name text,
  p_admin_code text,
  p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_code text := nullif(trim(coalesce(p_admin_code, '')), '');
  g public.kille_groups;
begin
  if v_name is null then
    raise exception 'GROUP_NAME_REQUIRED' using errcode = '22023';
  end if;
  if v_code is null or length(v_code) < 4 then
    raise exception 'ADMIN_CODE_TOO_SHORT' using errcode = '22023';
  end if;

  insert into public.kille_groups (name, join_code, admin_code_hash)
  values (v_name, public._kille_generate_join_code(), crypt(v_code, gen_salt('bf')))
  returning * into g;

  perform public._kille_upsert_member(g.id, p_member_name, 'admin');

  return public._kille_snapshot(g.id, 'admin');
end;
$$;

-- Logga in i en grupp med join-kod. Registrerar valfritt medlemsnamn.
create or replace function public.kille_join_group(
  p_join_code text,
  p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.kille_groups;
  v_role text := 'member';
begin
  select * into g
  from public.kille_groups
  where upper(join_code) = upper(trim(coalesce(p_join_code, '')));
  if not found then
    raise exception 'INVALID_GROUP_OR_CODE' using errcode = '28000';
  end if;

  v_role := coalesce(public._kille_upsert_member(g.id, p_member_name, 'member'), 'member');
  return public._kille_snapshot(g.id, v_role);
end;
$$;

-- Hämta senaste ögonblicksbild av gruppen.
create or replace function public.kille_pull(p_group_id uuid, p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.kille_groups;
begin
  g := public._kille_group_by_code(p_group_id, p_join_code);
  return public._kille_snapshot(g.id, 'member');
end;
$$;

-- Verifiera admin-kod (låser upp adminläge på enheten).
create or replace function public.kille_verify_admin(
  p_group_id uuid, p_join_code text, p_admin_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  return true;
end;
$$;

-- Spara (upsert) en spelare i gruppens gemensamma roster.
create or replace function public.kille_save_player(
  p_group_id uuid, p_join_code text, p_id text, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  insert into public.kille_group_players (id, group_id, name)
  values (p_id, p_group_id, p_name)
  on conflict (group_id, id) do update set name = excluded.name;
  return jsonb_build_object('ok', true);
end;
$$;

-- Ta bort en spelare från gruppens roster.
create or replace function public.kille_delete_player(
  p_group_id uuid, p_join_code text, p_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  delete from public.kille_group_players where group_id = p_group_id and id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Spara (upsert) ett helt spel i den centrala databasen.
create or replace function public.kille_save_game(
  p_group_id uuid, p_join_code text, p_game jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_game->>'id';
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  if v_id is null then
    raise exception 'GAME_ID_REQUIRED' using errcode = '22023';
  end if;
  insert into public.kille_group_games (id, group_id, data, status)
  values (v_id, p_group_id, p_game, coalesce(p_game->>'status', 'active'))
  on conflict (group_id, id)
  do update set data = excluded.data, status = excluded.status, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Ta bort ett spel ur den centrala databasen.
create or replace function public.kille_delete_game(
  p_group_id uuid, p_join_code text, p_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  delete from public.kille_group_games where group_id = p_group_id and id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Lämna gruppen (tar bort den egna medlemsposten).
create or replace function public.kille_leave_group(
  p_group_id uuid, p_join_code text, p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  delete from public.kille_group_members where group_id = p_group_id and id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── Admin-åtgärder (kräver admin-kod) ───────────────────────────────────────

create or replace function public.kille_admin_rename_group(
  p_group_id uuid, p_join_code text, p_admin_code text, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  if v_name is null then
    raise exception 'GROUP_NAME_REQUIRED' using errcode = '22023';
  end if;
  update public.kille_groups set name = v_name where id = p_group_id;
  return public._kille_snapshot(p_group_id, 'admin');
end;
$$;

create or replace function public.kille_admin_remove_member(
  p_group_id uuid, p_join_code text, p_admin_code text, p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  delete from public.kille_group_members
  where group_id = p_group_id and id = p_member_id and role <> 'admin';
  return public._kille_snapshot(p_group_id, 'admin');
end;
$$;

-- Sätt (eller återkalla) admin-rollen för en medlem.
create or replace function public.kille_admin_set_member_role(
  p_group_id uuid, p_join_code text, p_admin_code text, p_member_id uuid, p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  if p_role not in ('member', 'admin') then
    raise exception 'INVALID_ROLE' using errcode = '22023';
  end if;
  update public.kille_group_members
  set role = p_role
  where group_id = p_group_id and id = p_member_id;
  return public._kille_snapshot(p_group_id, 'admin');
end;
$$;

-- Byt admin-kod.
create or replace function public.kille_admin_set_code(
  p_group_id uuid, p_join_code text, p_admin_code text, p_new_admin_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := nullif(trim(coalesce(p_new_admin_code, '')), '');
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  if v_new is null or length(v_new) < 4 then
    raise exception 'ADMIN_CODE_TOO_SHORT' using errcode = '22023';
  end if;
  update public.kille_groups set admin_code_hash = crypt(v_new, gen_salt('bf'))
  where id = p_group_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Generera en ny join-kod (ogiltigförklarar den gamla).
create or replace function public.kille_admin_regenerate_join_code(
  p_group_id uuid, p_join_code text, p_admin_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  v_code := public._kille_generate_join_code();
  update public.kille_groups set join_code = v_code where id = p_group_id;
  return jsonb_build_object('joinCode', v_code);
end;
$$;

-- Radera hela gruppen och all dess data.
create or replace function public.kille_admin_delete_group(
  p_group_id uuid, p_join_code text, p_admin_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  delete from public.kille_groups where id = p_group_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── Rättigheter ─────────────────────────────────────────────────────────────
-- Endast EXECUTE på de publika RPC-funktionerna ges till anon. Interna
-- hjälpfunktioner (_kille_*) exponeras inte.

revoke all on function
  public._kille_group_by_code(uuid, text),
  public._kille_require_admin(uuid, text, text),
  public._kille_generate_join_code(),
  public._kille_snapshot(uuid, text),
  public._kille_upsert_member(uuid, text, text)
from anon, authenticated;

grant execute on function
  public.kille_create_group(text, text, text),
  public.kille_join_group(text, text),
  public.kille_pull(uuid, text),
  public.kille_verify_admin(uuid, text, text),
  public.kille_save_player(uuid, text, text, text),
  public.kille_delete_player(uuid, text, text),
  public.kille_save_game(uuid, text, jsonb),
  public.kille_delete_game(uuid, text, text),
  public.kille_leave_group(uuid, text, uuid),
  public.kille_admin_rename_group(uuid, text, text, text),
  public.kille_admin_remove_member(uuid, text, text, uuid),
  public.kille_admin_set_member_role(uuid, text, text, uuid, text),
  public.kille_admin_set_code(uuid, text, text, text),
  public.kille_admin_regenerate_join_code(uuid, text, text),
  public.kille_admin_delete_group(uuid, text, text)
to anon, authenticated;
