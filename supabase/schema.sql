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

-- pgcrypto ger crypt()/gen_salt() för lösenordshashning. På Supabase installeras
-- den i schemat "extensions", därför har funktionerna nedan
-- `search_path = public, extensions` så att crypt/gen_salt hittas.
create extension if not exists pgcrypto;

-- ─── Tabeller ────────────────────────────────────────────────────────────────

create table if not exists public.kille_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique,
  join_code       text not null unique,
  admin_code_hash text not null,
  created_at      timestamptz not null default now()
);

-- Idempotent för databaser som skapades innan slug fanns.
alter table public.kille_groups add column if not exists slug text;
create unique index if not exists kille_groups_slug_key on public.kille_groups (slug);

-- Globala administratörer (super-admin) som hanterar alla grupper och användare.
create table if not exists public.kille_admins (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.kille_group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.kille_groups(id) on delete cascade,
  name       text not null,
  role       text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

-- Unikt medlemsnamn per grupp (skiftlägesokänsligt). Uttrycket kräver ett
-- unikt index — det kan inte uttryckas som en vanlig UNIQUE-constraint.
create unique index if not exists kille_group_members_group_name_key
  on public.kille_group_members (group_id, lower(name));

-- Senast aktiv-tidsstämpel per medlem (heartbeat) — driver "aktiva medlemmar".
-- Idempotent för databaser som skapades innan kolumnen fanns.
alter table public.kille_group_members add column if not exists last_seen_at timestamptz;

create table if not exists public.kille_group_players (
  id         text not null,
  group_id   uuid not null references public.kille_groups(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, id)
);

-- Personer: samma människa dyker ofta upp i flera grupper, och kan finnas både
-- som medlem (inloggning) och som spelare (roster) i samma grupp. En rad här
-- knyter ihop de identiteterna till EN person. Sammanslagningen är en koppling,
-- inte en flytt: varje grupp behåller sina spelare, protokoll och statistik —
-- men super-admin ser och hanterar dem som en enda användare.
create table if not exists public.kille_people (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- Idempotent för databaser som skapades innan personer fanns.
alter table public.kille_group_players
  add column if not exists person_id uuid references public.kille_people(id) on delete set null;
alter table public.kille_group_members
  add column if not exists person_id uuid references public.kille_people(id) on delete set null;

create index if not exists kille_group_players_person on public.kille_group_players (person_id);
create index if not exists kille_group_members_person on public.kille_group_members (person_id);

create table if not exists public.kille_group_games (
  id         text not null,
  group_id   uuid not null references public.kille_groups(id) on delete cascade,
  data       jsonb not null,
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, id)
);

-- Turneringar: deltagare, omgångar och bord. Varje bord pekar på ett spel i
-- kille_group_games via spelets id, så protokollen delas med den vanliga
-- historiken och statistiken.
create table if not exists public.kille_group_tournaments (
  id         text not null,
  group_id   uuid not null references public.kille_groups(id) on delete cascade,
  data       jsonb not null,
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, id)
);

-- Användnings-/aktivitetslogg (append-only). Fylls dels automatiskt inifrån
-- SECURITY DEFINER-funktionerna nedan (data-/sessionshändelser, admin-åtgärder),
-- dels av klienten via kille_log_activity (produktanalys: skärmvisningar m.m.).
-- Läses bara av super-admin. `member_name` sparas denormaliserat så att en
-- händelse behåller vem som gjorde den även om medlemmen senare tas bort.
create table if not exists public.kille_activity (
  id          bigint generated always as identity primary key,
  group_id    uuid references public.kille_groups(id) on delete cascade,
  member_id   uuid,
  member_name text,
  event_type  text not null,
  category    text not null default 'data',   -- session | data | product | admin
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists kille_activity_group_time on public.kille_activity (group_id, created_at desc);
create index if not exists kille_activity_time       on public.kille_activity (created_at desc);
create index if not exists kille_activity_type_time  on public.kille_activity (event_type, created_at desc);

-- ─── Row Level Security (deny-all för anon; åtkomst via RPC nedan) ────────────

alter table public.kille_groups          enable row level security;
alter table public.kille_group_members   enable row level security;
alter table public.kille_group_players   enable row level security;
alter table public.kille_group_games     enable row level security;
alter table public.kille_group_tournaments enable row level security;
alter table public.kille_admins          enable row level security;
alter table public.kille_people          enable row level security;
alter table public.kille_activity        enable row level security;

revoke all on public.kille_groups        from anon, authenticated;
revoke all on public.kille_group_members from anon, authenticated;
revoke all on public.kille_group_players from anon, authenticated;
revoke all on public.kille_group_games   from anon, authenticated;
revoke all on public.kille_group_tournaments from anon, authenticated;
revoke all on public.kille_admins        from anon, authenticated;
revoke all on public.kille_people        from anon, authenticated;
revoke all on public.kille_activity      from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Interna hjälpfunktioner
-- ═══════════════════════════════════════════════════════════════════════════

-- Verifierar join_code och returnerar gruppraden, annars fel.
create or replace function public._kille_group_by_code(p_group_id uuid, p_join_code text)
returns public.kille_groups
language plpgsql
security definer
set search_path = public, extensions
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
set search_path = public, extensions
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
set search_path = public, extensions
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

-- Gör om ett gruppnamn till en URL-vänlig slug (t.ex. "gustavsson-and-friends").
create or replace function public._kille_slugify(p_text text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s text;
begin
  s := lower(trim(coalesce(p_text, '')));
  -- Translitterera vanliga svenska/nordiska tecken.
  s := translate(s, 'åäàáâãöøòóôõüùúûñçéèêëíìîïý',
                    'aaaaaaoooooouuuunceeeeiiiiy');
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');   -- allt annat → bindestreck
  s := regexp_replace(s, '-+', '-', 'g');           -- kollapsa bindestreck
  s := trim(both '-' from s);
  if s = '' then s := 'grupp'; end if;
  return s;
end;
$$;

-- Skapar en unik slug utifrån ett namn (lägger till -2, -3 … vid krock).
create or replace function public._kille_unique_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base text := public._kille_slugify(p_name);
  candidate text := base;
  n int := 1;
begin
  while exists (select 1 from public.kille_groups where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;

-- Bygger en komplett ögonblicksbild av en grupp (för login/pull).
create or replace function public._kille_snapshot(p_group_id uuid, p_role text default 'member')
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'group', (
      select jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'slug', g.slug,
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
    ), '[]'::jsonb),
    'tournaments', coalesce((
      select jsonb_agg(tn.data order by tn.created_at)
      from public.kille_group_tournaments tn where tn.group_id = p_group_id
    ), '[]'::jsonb)
  );
$$;

-- Upsertar en medlem (unikt namn per grupp) och returnerar rollen.
create or replace function public._kille_upsert_member(p_group_id uuid, p_name text, p_role text default 'member')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_role text;
begin
  if v_name is null then
    return null;
  end if;
  insert into public.kille_group_members (group_id, name, role, last_seen_at)
  values (p_group_id, v_name, p_role, now())
  on conflict (group_id, lower(name))
  do update set role = case when public.kille_group_members.role = 'admin'
                            then 'admin' else excluded.role end,
                last_seen_at = now()
  returning role into v_role;
  return v_role;
end;
$$;

-- Normaliserad namnnyckel: hittar samma namn oavsett skiftläge, mellanslag och
-- svenska tecken ("Robert", "robert " och "RÓBERT" ger alla nyckeln "robert").
create or replace function public._kille_name_key(p_name text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select regexp_replace(
           translate(lower(trim(coalesce(p_name, ''))),
                     'åäàáâãöøòóôõüùúûñçéèêëíìîïý',
                     'aaaaaaoooooouuuunceeeeiiiiy'),
           '[^a-z0-9]+', '', 'g');
$$;

-- Spelarens statistik inom en grupp: antal spel hen deltagit i och antal
-- vunna omgångar. Läses ur protokollens jsonb, samma källa som appens statistik.
create or replace function public._kille_player_stats(p_group_id uuid, p_player_id text)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'games', (select count(*) from public.kille_group_games gm
              where gm.group_id = p_group_id
                and jsonb_exists(coalesce(gm.data->'playerIds', '[]'::jsonb), p_player_id)),
    'wins',  (select count(*) from public.kille_group_games gm
              cross join lateral jsonb_array_elements(coalesce(gm.data->'rounds', '[]'::jsonb)) r
              where gm.group_id = p_group_id and r->>'winnerId' = p_player_id)
  );
$$;

-- ─── Aktivitetsloggning ────────────────────────────────────────────────────────

-- Skriver en rad i aktivitetsloggen. Anropas inifrån andra SECURITY DEFINER-
-- funktioner; misslyckas aldrig tyst-kritiskt eftersom den är en ren insert.
create or replace function public._kille_log(
  p_group_id uuid, p_member_id uuid, p_member_name text,
  p_event_type text, p_category text default 'data', p_detail jsonb default null
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.kille_activity (group_id, member_id, member_name, event_type, category, detail)
  values (p_group_id, p_member_id, nullif(trim(coalesce(p_member_name, '')), ''),
          p_event_type, coalesce(p_category, 'data'), p_detail);
$$;

-- Uppdaterar "senast aktiv" för en medlem (heartbeat). No-op om id saknas.
create or replace function public._kille_touch_member(p_group_id uuid, p_member_id uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.kille_group_members
  set last_seen_at = now()
  where group_id = p_group_id and id = p_member_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Publika RPC-funktioner (anropas av klienten med anon-nyckeln)
-- ═══════════════════════════════════════════════════════════════════════════

-- Skapa en ny grupp. Den som skapar blir admin och sätter en hemlig admin-kod.
create or replace function public.kille_create_group(
  p_name text,
  p_admin_code text,
  p_member_name text default null,
  p_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_code text := nullif(trim(coalesce(p_admin_code, '')), '');
  v_slug text;
  g public.kille_groups;
begin
  if v_name is null then
    raise exception 'GROUP_NAME_REQUIRED' using errcode = '22023';
  end if;
  if v_code is null or length(v_code) < 4 then
    raise exception 'ADMIN_CODE_TOO_SHORT' using errcode = '22023';
  end if;

  -- Slug: använd önskad om ledig, annars härled unik från namnet.
  v_slug := nullif(public._kille_slugify(coalesce(p_slug, '')), 'grupp');
  if v_slug is null or exists (select 1 from public.kille_groups where slug = v_slug) then
    v_slug := public._kille_unique_slug(coalesce(nullif(p_slug, ''), v_name));
  end if;

  insert into public.kille_groups (name, slug, join_code, admin_code_hash)
  values (v_name, v_slug, public._kille_generate_join_code(), crypt(v_code, gen_salt('bf')))
  returning * into g;

  perform public._kille_upsert_member(g.id, p_member_name, 'admin');

  perform public._kille_log(
    g.id,
    (select id from public.kille_group_members
      where group_id = g.id and lower(name) = lower(trim(coalesce(p_member_name, '')))),
    p_member_name, 'group_created', 'session', jsonb_build_object('slug', v_slug));

  return public._kille_snapshot(g.id, 'admin');
end;
$$;

-- Hämta en grupp via dess slug (används för URL-åtkomst /?g=slug).
-- Registrerar valfritt ett medlemsnamn, precis som kille_join_group.
create or replace function public.kille_get_group_by_slug(
  p_slug text,
  p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g public.kille_groups;
  v_role text := 'member';
begin
  select * into g from public.kille_groups
  where slug = public._kille_slugify(coalesce(p_slug, ''));
  if not found then
    raise exception 'INVALID_GROUP_OR_CODE' using errcode = '28000';
  end if;
  v_role := coalesce(public._kille_upsert_member(g.id, p_member_name, 'member'), 'member');
  if nullif(trim(coalesce(p_member_name, '')), '') is not null then
    perform public._kille_log(
      g.id,
      (select id from public.kille_group_members
        where group_id = g.id and lower(name) = lower(trim(p_member_name))),
      p_member_name, 'login', 'session', jsonb_build_object('via', 'slug'));
  end if;
  return public._kille_snapshot(g.id, v_role);
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
set search_path = public, extensions
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
  if nullif(trim(coalesce(p_member_name, '')), '') is not null then
    perform public._kille_log(
      g.id,
      (select id from public.kille_group_members
        where group_id = g.id and lower(name) = lower(trim(p_member_name))),
      p_member_name, 'login', 'session', null);
  end if;
  return public._kille_snapshot(g.id, v_role);
end;
$$;

-- Hämta senaste ögonblicksbild av gruppen. p_member_id (valfritt) uppdaterar
-- medlemmens "senast aktiv" (heartbeat) — men loggar ingen händelse, eftersom
-- pull körs ofta (uppstart/återanslutning) och annars skulle dränka flödet.
drop function if exists public.kille_pull(uuid, text);
create or replace function public.kille_pull(
  p_group_id uuid, p_join_code text, p_member_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g public.kille_groups;
begin
  g := public._kille_group_by_code(p_group_id, p_join_code);
  if p_member_id is not null then
    perform public._kille_touch_member(g.id, p_member_id);
  end if;
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
set search_path = public, extensions
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  return true;
end;
$$;

-- Spara (upsert) en spelare i gruppens gemensamma roster.
-- p_member_id/p_member_name (valfria) anger vem som gjorde ändringen och används
-- för aktivitetsloggen samt "senast aktiv".
drop function if exists public.kille_save_player(uuid, text, text, text);
create or replace function public.kille_save_player(
  p_group_id uuid, p_join_code text, p_id text, p_name text,
  p_member_id uuid default null, p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existed boolean;
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  select exists(select 1 from public.kille_group_players where group_id = p_group_id and id = p_id)
    into v_existed;
  insert into public.kille_group_players (id, group_id, name)
  values (p_id, p_group_id, p_name)
  on conflict (group_id, id) do update set name = excluded.name;
  perform public._kille_touch_member(p_group_id, p_member_id);
  perform public._kille_log(p_group_id, p_member_id, p_member_name,
    case when v_existed then 'player_renamed' else 'player_added' end, 'data',
    jsonb_build_object('playerId', p_id, 'playerName', p_name));
  return jsonb_build_object('ok', true);
end;
$$;

-- Ta bort en spelare från gruppens roster.
drop function if exists public.kille_delete_player(uuid, text, text);
create or replace function public.kille_delete_player(
  p_group_id uuid, p_join_code text, p_id text,
  p_member_id uuid default null, p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  delete from public.kille_group_players where group_id = p_group_id and id = p_id;
  perform public._kille_touch_member(p_group_id, p_member_id);
  perform public._kille_log(p_group_id, p_member_id, p_member_name,
    'player_removed', 'data', jsonb_build_object('playerId', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Spara (upsert) ett helt spel i den centrala databasen.
drop function if exists public.kille_save_game(uuid, text, jsonb);
create or replace function public.kille_save_game(
  p_group_id uuid, p_join_code text, p_game jsonb,
  p_member_id uuid default null, p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text := p_game->>'id';
  v_existed boolean;
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  if v_id is null then
    raise exception 'GAME_ID_REQUIRED' using errcode = '22023';
  end if;
  select exists(select 1 from public.kille_group_games where group_id = p_group_id and id = v_id)
    into v_existed;
  insert into public.kille_group_games (id, group_id, data, status)
  values (v_id, p_group_id, p_game, coalesce(p_game->>'status', 'active'))
  on conflict (group_id, id)
  do update set data = excluded.data, status = excluded.status, updated_at = now();
  perform public._kille_touch_member(p_group_id, p_member_id);
  perform public._kille_log(p_group_id, p_member_id, p_member_name,
    case when v_existed then 'game_updated' else 'game_saved' end, 'data',
    jsonb_build_object('gameId', v_id, 'status', coalesce(p_game->>'status', 'active')));
  return jsonb_build_object('ok', true);
end;
$$;

-- Ta bort ett spel ur den centrala databasen.
drop function if exists public.kille_delete_game(uuid, text, text);
create or replace function public.kille_delete_game(
  p_group_id uuid, p_join_code text, p_id text,
  p_member_id uuid default null, p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  delete from public.kille_group_games where group_id = p_group_id and id = p_id;
  perform public._kille_touch_member(p_group_id, p_member_id);
  perform public._kille_log(p_group_id, p_member_id, p_member_name,
    'game_deleted', 'data', jsonb_build_object('gameId', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Spara (upsert) en hel turnering i den centrala databasen. Turneringens bord
-- pekar på vanliga spel, som sparas för sig via kille_save_game.
drop function if exists public.kille_save_tournament(uuid, text, jsonb);
create or replace function public.kille_save_tournament(
  p_group_id uuid, p_join_code text, p_tournament jsonb,
  p_member_id uuid default null, p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text := p_tournament->>'id';
  v_existed boolean;
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  if v_id is null then
    raise exception 'TOURNAMENT_ID_REQUIRED' using errcode = '22023';
  end if;
  select exists(select 1 from public.kille_group_tournaments where group_id = p_group_id and id = v_id)
    into v_existed;
  insert into public.kille_group_tournaments (id, group_id, data, status)
  values (v_id, p_group_id, p_tournament, coalesce(p_tournament->>'status', 'active'))
  on conflict (group_id, id)
  do update set data = excluded.data, status = excluded.status, updated_at = now();
  perform public._kille_touch_member(p_group_id, p_member_id);
  perform public._kille_log(p_group_id, p_member_id, p_member_name,
    case when v_existed then 'tournament_updated' else 'tournament_saved' end, 'data',
    jsonb_build_object('tournamentId', v_id, 'status', coalesce(p_tournament->>'status', 'active')));
  return jsonb_build_object('ok', true);
end;
$$;

-- Ta bort en turnering. Spelen den pekar på ligger kvar i historiken.
drop function if exists public.kille_delete_tournament(uuid, text, text);
create or replace function public.kille_delete_tournament(
  p_group_id uuid, p_join_code text, p_id text,
  p_member_id uuid default null, p_member_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  delete from public.kille_group_tournaments where group_id = p_group_id and id = p_id;
  perform public._kille_touch_member(p_group_id, p_member_id);
  perform public._kille_log(p_group_id, p_member_id, p_member_name,
    'tournament_deleted', 'data', jsonb_build_object('tournamentId', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Ta emot en batch klient-genererade produktanalys-händelser (skärmvisningar,
-- funktionsanvändning, PWA-installation). Varje element i p_events är
-- {type, detail, at?}. Skrivs med category='product'. Gated på join-koden precis
-- som andra medlems-operationer. Uppdaterar även medlemmens "senast aktiv".
create or replace function public.kille_log_activity(
  p_group_id uuid, p_join_code text, p_member_id uuid, p_member_name text, p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ev jsonb;
  v_count int := 0;
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'EVENTS_MUST_BE_ARRAY' using errcode = '22023';
  end if;
  for ev in select * from jsonb_array_elements(p_events) loop
    if nullif(trim(coalesce(ev->>'type', '')), '') is null then
      continue;
    end if;
    insert into public.kille_activity (group_id, member_id, member_name, event_type, category, detail, created_at)
    values (
      p_group_id, p_member_id, nullif(trim(coalesce(p_member_name, '')), ''),
      ev->>'type', 'product', ev->'detail',
      coalesce((ev->>'at')::timestamptz, now()));
    v_count := v_count + 1;
  end loop;
  perform public._kille_touch_member(p_group_id, p_member_id);
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Lämna gruppen (tar bort den egna medlemsposten).
create or replace function public.kille_leave_group(
  p_group_id uuid, p_join_code text, p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
begin
  perform public._kille_group_by_code(p_group_id, p_join_code);
  select name into v_name from public.kille_group_members
    where group_id = p_group_id and id = p_member_id;
  delete from public.kille_group_members where group_id = p_group_id and id = p_member_id;
  perform public._kille_log(p_group_id, p_member_id, v_name, 'member_left', 'session', null);
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
set search_path = public, extensions
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  if v_name is null then
    raise exception 'GROUP_NAME_REQUIRED' using errcode = '22023';
  end if;
  update public.kille_groups set name = v_name where id = p_group_id;
  perform public._kille_log(p_group_id, null, null, 'admin_action', 'admin',
    jsonb_build_object('action', 'rename_group', 'name', v_name));
  return public._kille_snapshot(p_group_id, 'admin');
end;
$$;

create or replace function public.kille_admin_remove_member(
  p_group_id uuid, p_join_code text, p_admin_code text, p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  delete from public.kille_group_members
  where group_id = p_group_id and id = p_member_id and role <> 'admin';
  perform public._kille_log(p_group_id, null, null, 'admin_action', 'admin',
    jsonb_build_object('action', 'remove_member', 'memberId', p_member_id));
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
set search_path = public, extensions
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  if p_role not in ('member', 'admin') then
    raise exception 'INVALID_ROLE' using errcode = '22023';
  end if;
  update public.kille_group_members
  set role = p_role
  where group_id = p_group_id and id = p_member_id;
  perform public._kille_log(p_group_id, null, null, 'admin_action', 'admin',
    jsonb_build_object('action', 'set_member_role', 'memberId', p_member_id, 'role', p_role));
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
set search_path = public, extensions
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
  perform public._kille_log(p_group_id, null, null, 'admin_action', 'admin',
    jsonb_build_object('action', 'set_admin_code'));
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
set search_path = public, extensions
as $$
declare
  v_code text;
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  v_code := public._kille_generate_join_code();
  update public.kille_groups set join_code = v_code where id = p_group_id;
  perform public._kille_log(p_group_id, null, null, 'admin_action', 'admin',
    jsonb_build_object('action', 'regenerate_join_code'));
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
set search_path = public, extensions
as $$
begin
  perform public._kille_require_admin(p_group_id, p_join_code, p_admin_code);
  delete from public.kille_groups where id = p_group_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Super-admin: global inloggning (användarnamn + lösenord) som hanterar
-- alla grupper och användare. Prefix kille_sa_.
-- ═══════════════════════════════════════════════════════════════════════════

-- Verifierar super-admin-uppgifter, annars fel.
create or replace function public._kille_require_sa(p_username text, p_password text)
returns public.kille_admins
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a public.kille_admins;
begin
  select * into a from public.kille_admins
  where username = lower(trim(coalesce(p_username, '')));
  if not found or a.password_hash <> crypt(coalesce(p_password, ''), a.password_hash) then
    raise exception 'INVALID_ADMIN_LOGIN' using errcode = '28000';
  end if;
  return a;
end;
$$;

-- Finns någon super-admin uppsatt ännu? (publikt — avslöjar inget känsligt)
create or replace function public.kille_sa_exists()
returns boolean
language sql
security definer
set search_path = public, extensions
as $$ select exists (select 1 from public.kille_admins); $$;

-- Skapa den första super-adminen (fungerar bara om ingen finns ännu).
create or replace function public.kille_sa_bootstrap(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user text := lower(trim(coalesce(p_username, '')));
begin
  if exists (select 1 from public.kille_admins) then
    raise exception 'ADMIN_ALREADY_EXISTS' using errcode = '42501';
  end if;
  if v_user = '' or length(coalesce(p_password, '')) < 6 then
    raise exception 'ADMIN_CODE_TOO_SHORT' using errcode = '22023';
  end if;
  insert into public.kille_admins (username, password_hash)
  values (v_user, crypt(p_password, gen_salt('bf')));
  return jsonb_build_object('ok', true, 'username', v_user);
end;
$$;

-- Logga in som super-admin.
create or replace function public.kille_sa_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare a public.kille_admins;
begin
  a := public._kille_require_sa(p_username, p_password);
  return jsonb_build_object('ok', true, 'username', a.username);
end;
$$;

-- Lägg till ytterligare en super-admin.
create or replace function public.kille_sa_add_admin(
  p_username text, p_password text, p_new_username text, p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_user text := lower(trim(coalesce(p_new_username, '')));
begin
  perform public._kille_require_sa(p_username, p_password);
  if v_user = '' or length(coalesce(p_new_password, '')) < 6 then
    raise exception 'ADMIN_CODE_TOO_SHORT' using errcode = '22023';
  end if;
  insert into public.kille_admins (username, password_hash)
  values (v_user, crypt(p_new_password, gen_salt('bf')));
  return jsonb_build_object('ok', true, 'username', v_user);
end;
$$;

-- Lista alla grupper med räknare (för super-admin-konsolen).
create or replace function public.kille_sa_list_groups(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_sa(p_username, p_password);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'slug', g.slug,
      'joinCode', g.join_code,
      'createdAt', g.created_at,
      'members', (select count(*) from public.kille_group_members m where m.group_id = g.id),
      'players', (select count(*) from public.kille_group_players p where p.group_id = g.id),
      'games',   (select count(*) from public.kille_group_games gm where gm.group_id = g.id),
      'lastActivityAt', (select max(a.created_at) from public.kille_activity a where a.group_id = g.id),
      'activeMembers7d', (select count(*) from public.kille_group_members m
                          where m.group_id = g.id and m.last_seen_at >= now() - interval '7 days'),
      'eventsLast7d', (select count(*) from public.kille_activity a
                       where a.group_id = g.id and a.created_at >= now() - interval '7 days')
    ) order by g.created_at desc)
    from public.kille_groups g
  ), '[]'::jsonb);
end;
$$;

-- Super-admin: plattforms-övergripande användningsöversikt (KPI:er + tidsserie).
create or replace function public.kille_sa_usage_overview(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform public._kille_require_sa(p_username, p_password);
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'groups',  (select count(*) from public.kille_groups),
      'members', (select count(*) from public.kille_group_members),
      'players', (select count(*) from public.kille_group_players),
      'games',   (select count(*) from public.kille_group_games),
      'events',  (select count(*) from public.kille_activity)
    ),
    'activeGroups7d', (select count(distinct group_id) from public.kille_activity
                       where created_at >= now() - interval '7 days'),
    'activeGroups30d', (select count(distinct group_id) from public.kille_activity
                        where created_at >= now() - interval '30 days'),
    'activeMembers7d', (select count(*) from public.kille_group_members
                        where last_seen_at >= now() - interval '7 days'),
    'activeMembers30d', (select count(*) from public.kille_group_members
                         where last_seen_at >= now() - interval '30 days'),
    'eventsToday', (select count(*) from public.kille_activity
                    where created_at >= date_trunc('day', now())),
    'events7d', (select count(*) from public.kille_activity
                 where created_at >= now() - interval '7 days'),
    'events30d', (select count(*) from public.kille_activity
                  where created_at >= now() - interval '30 days'),
    'dailySeries', coalesce((
      select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'count', d.cnt)
                       order by d.day)
      from (
        select gs::date as day,
               (select count(*) from public.kille_activity a
                where a.created_at >= gs and a.created_at < gs + interval '1 day') as cnt
        from generate_series(date_trunc('day', now()) - interval '29 days',
                             date_trunc('day', now()), interval '1 day') gs
      ) d
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Super-admin: senaste aktivitetsflöde (namngivet) över alla grupper.
-- Keyset-paginerat på created_at (skicka p_before = äldsta redan hämtade tid).
create or replace function public.kille_sa_activity_feed(
  p_username text, p_password text,
  p_limit int default 50, p_before timestamptz default null,
  p_group_id uuid default null, p_event_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform public._kille_require_sa(p_username, p_password);
  return coalesce((
    select jsonb_agg(row_to_json(t))
    from (
      select a.id, a.event_type as "eventType", a.category,
             a.member_name as "memberName", a.detail, a.created_at as "createdAt",
             a.group_id as "groupId", g.name as "groupName", g.slug as "groupSlug"
      from public.kille_activity a
      left join public.kille_groups g on g.id = a.group_id
      where (p_before is null or a.created_at < p_before)
        and (p_group_id is null or a.group_id = p_group_id)
        and (nullif(trim(coalesce(p_event_type, '')), '') is null or a.event_type = p_event_type)
      order by a.created_at desc, a.id desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

-- Skapa en grupp som super-admin.
create or replace function public.kille_sa_create_group(
  p_username text, p_password text, p_name text, p_admin_code text, p_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_sa(p_username, p_password);
  return public.kille_create_group(p_name, p_admin_code, null, p_slug);
end;
$$;

create or replace function public.kille_sa_rename_group(
  p_username text, p_password text, p_group_id uuid, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  perform public._kille_require_sa(p_username, p_password);
  if v_name is null then raise exception 'GROUP_NAME_REQUIRED' using errcode = '22023'; end if;
  update public.kille_groups set name = v_name where id = p_group_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.kille_sa_set_slug(
  p_username text, p_password text, p_group_id uuid, p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_slug text;
begin
  perform public._kille_require_sa(p_username, p_password);
  v_slug := public._kille_slugify(coalesce(p_slug, ''));
  if exists (select 1 from public.kille_groups where slug = v_slug and id <> p_group_id) then
    v_slug := public._kille_unique_slug(p_slug);
  end if;
  update public.kille_groups set slug = v_slug where id = p_group_id;
  return jsonb_build_object('slug', v_slug);
end;
$$;

create or replace function public.kille_sa_regen_code(
  p_username text, p_password text, p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_code text;
begin
  perform public._kille_require_sa(p_username, p_password);
  v_code := public._kille_generate_join_code();
  update public.kille_groups set join_code = v_code where id = p_group_id;
  return jsonb_build_object('joinCode', v_code);
end;
$$;

create or replace function public.kille_sa_delete_group(
  p_username text, p_password text, p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_sa(p_username, p_password);
  delete from public.kille_groups where id = p_group_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Lista medlemmar + spelare i en grupp (för användarhantering).
create or replace function public.kille_sa_list_users(
  p_username text, p_password text, p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_sa(p_username, p_password);
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.name, 'role', m.role, 'personId', m.person_id)
        order by m.role desc, m.created_at)
      from public.kille_group_members m where m.group_id = p_group_id), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.name, 'personId', p.person_id)
        order by p.created_at)
      from public.kille_group_players p where p.group_id = p_group_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.kille_sa_remove_member(
  p_username text, p_password text, p_group_id uuid, p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_sa(p_username, p_password);
  delete from public.kille_group_members where group_id = p_group_id and id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.kille_sa_remove_player(
  p_username text, p_password text, p_group_id uuid, p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_sa(p_username, p_password);
  delete from public.kille_group_players where group_id = p_group_id and id = p_player_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── Titta i en grupp (läsläge) ──────────────────────────────────────────────
-- Hela gruppens innehåll i ett anrop: medlemmar, spelare med statistik,
-- protokoll, turneringar och senaste aktivitet. Super-admin kan därmed titta
-- in i vilken grupp som helst utan att känna till dess grupp- eller admin-kod.
create or replace function public.kille_sa_group_detail(
  p_username text, p_password text, p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_result jsonb;
begin
  perform public._kille_require_sa(p_username, p_password);
  if not exists (select 1 from public.kille_groups where id = p_group_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'group', (
      select jsonb_build_object(
        'id', g.id, 'name', g.name, 'slug', g.slug, 'joinCode', g.join_code,
        'createdAt', g.created_at,
        'lastActivityAt', (select max(a.created_at) from public.kille_activity a
                           where a.group_id = g.id)
      )
      from public.kille_groups g where g.id = p_group_id),

    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'role', m.role, 'personId', m.person_id,
        'lastSeenAt', m.last_seen_at, 'createdAt', m.created_at
      ) order by m.role desc, m.created_at)
      from public.kille_group_members m where m.group_id = p_group_id), '[]'::jsonb),

    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'personId', p.person_id, 'createdAt', p.created_at,
        'games', (public._kille_player_stats(p.group_id, p.id)->>'games')::int,
        'wins',  (public._kille_player_stats(p.group_id, p.id)->>'wins')::int
      ) order by p.created_at)
      from public.kille_group_players p where p.group_id = p_group_id), '[]'::jsonb),

    'games', coalesce((
      select jsonb_agg(s.j order by s.srt desc)
      from (
        select gm.created_at as srt, jsonb_build_object(
          'id', gm.id, 'status', gm.status,
          'createdAt', gm.created_at, 'updatedAt', gm.updated_at,
          'rounds', jsonb_array_length(coalesce(gm.data->'rounds', '[]'::jsonb)),
          'players', coalesce((
            select jsonb_agg(coalesce(pl.name, t.pid))
            from jsonb_array_elements_text(coalesce(gm.data->'playerIds', '[]'::jsonb)) as t(pid)
            left join public.kille_group_players pl
              on pl.group_id = gm.group_id and pl.id = t.pid), '[]'::jsonb)
        ) as j
        from public.kille_group_games gm
        where gm.group_id = p_group_id
        order by gm.created_at desc
        limit 100) s), '[]'::jsonb),

    'tournaments', coalesce((
      select jsonb_agg(s.j order by s.srt desc)
      from (
        select tn.created_at as srt, jsonb_build_object(
          'id', tn.id, 'name', tn.data->>'name', 'status', tn.status,
          'createdAt', tn.created_at,
          'participants', jsonb_array_length(coalesce(tn.data->'playerIds', '[]'::jsonb)),
          'rounds', jsonb_array_length(coalesce(tn.data->'rounds', '[]'::jsonb))
        ) as j
        from public.kille_group_tournaments tn
        where tn.group_id = p_group_id
        order by tn.created_at desc
        limit 100) s), '[]'::jsonb),

    'activity', coalesce((
      select jsonb_agg(s.j order by s.srt desc)
      from (
        select a.created_at as srt, jsonb_build_object(
          'id', a.id, 'eventType', a.event_type, 'category', a.category,
          'memberName', a.member_name, 'detail', a.detail, 'createdAt', a.created_at
        ) as j
        from public.kille_activity a
        where a.group_id = p_group_id
        order by a.created_at desc, a.id desc
        limit 30) s), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ─── Användare över gruppgränserna ───────────────────────────────────────────
-- Alla identiteter i plattformen (spelare + medlemmar) grupperade dels per
-- sammanslagen person, dels per normaliserat namn. Namn som förekommer på
-- flera håll utan att vara ihopknutna markeras `mergeable` — det är dem
-- super-admin kan slå ihop.
create or replace function public.kille_sa_list_people(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_result jsonb;
begin
  perform public._kille_require_sa(p_username, p_password);

  with ident as (
    select 'player'::text as kind, pl.id as id, pl.group_id, g.name as group_name,
           g.slug as group_slug, pl.name, pl.person_id,
           (public._kille_player_stats(pl.group_id, pl.id)->>'games')::int as games,
           (public._kille_player_stats(pl.group_id, pl.id)->>'wins')::int as wins
    from public.kille_group_players pl
    join public.kille_groups g on g.id = pl.group_id
    union all
    select 'member'::text, m.id::text, m.group_id, g.name, g.slug, m.name, m.person_id, 0, 0
    from public.kille_group_members m
    join public.kille_groups g on g.id = m.group_id
  )
  select jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pe.id,
        'displayName', pe.display_name,
        'createdAt', pe.created_at,
        'groups', (select count(distinct i.group_id) from ident i where i.person_id = pe.id),
        'games',  (select coalesce(sum(i.games), 0) from ident i where i.person_id = pe.id),
        'wins',   (select coalesce(sum(i.wins), 0) from ident i where i.person_id = pe.id),
        'identities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', i.kind, 'id', i.id, 'groupId', i.group_id, 'groupName', i.group_name,
            'name', i.name, 'games', i.games, 'wins', i.wins
          ) order by i.group_name, i.kind, i.name)
          from ident i where i.person_id = pe.id), '[]'::jsonb)
      ) order by pe.display_name)
      from public.kille_people pe), '[]'::jsonb),

    'names', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', k.name_key,
        'name', k.display,
        'groups', k.group_count,
        'mergeable', k.mergeable,
        'occurrences', k.occurrences
      ) order by k.mergeable desc, k.display)
      from (
        select public._kille_name_key(i.name) as name_key,
               min(i.name) as display,
               count(distinct i.group_id) as group_count,
               (count(*) > 1 and (bool_or(i.person_id is null)
                                  or count(distinct i.person_id) > 1)) as mergeable,
               jsonb_agg(jsonb_build_object(
                 'kind', i.kind, 'id', i.id, 'groupId', i.group_id,
                 'groupName', i.group_name, 'name', i.name, 'personId', i.person_id,
                 'games', i.games, 'wins', i.wins
               ) order by i.group_name, i.kind, i.name) as occurrences
        from ident i
        group by public._kille_name_key(i.name)) k), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Slå ihop identiteter till en person. `p_identities` är en array av
-- {kind: 'player'|'member', groupId, id}. Är någon av dem redan kopplad till en
-- person återanvänds den (och eventuella övriga personer absorberas), annars
-- skapas en ny. Inga protokoll rörs — kopplingen är ren identitetsdata.
create or replace function public.kille_sa_merge_people(
  p_username text, p_password text,
  p_identities jsonb,
  p_display_name text default null,
  p_person_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_person   uuid := p_person_id;
  v_name     text := nullif(trim(coalesce(p_display_name, '')), '');
  v_absorbed uuid[];
  v_count    int;
begin
  perform public._kille_require_sa(p_username, p_password);

  if p_identities is null or jsonb_typeof(p_identities) <> 'array'
     or jsonb_array_length(p_identities) < 2 then
    raise exception 'MERGE_NEEDS_TWO' using errcode = '22023';
  end if;

  -- Personer som de valda identiteterna redan tillhör.
  select coalesce(array_agg(distinct pid), '{}'::uuid[]) into v_absorbed
  from (
    select pl.person_id as pid
    from jsonb_to_recordset(p_identities) as t(kind text, "groupId" uuid, id text)
    join public.kille_group_players pl on pl.group_id = t."groupId" and pl.id = t.id
    where t.kind = 'player' and pl.person_id is not null
    union
    select m.person_id
    from jsonb_to_recordset(p_identities) as t(kind text, "groupId" uuid, id text)
    join public.kille_group_members m on m.group_id = t."groupId" and m.id::text = t.id
    where t.kind = 'member' and m.person_id is not null
  ) s;

  if v_person is null then
    v_person := (select x from unnest(v_absorbed) x limit 1);
  end if;

  -- Utan valt namn: ta namnet från första identiteten i urvalet.
  if v_name is null then
    select coalesce(
      (select pl.name
       from jsonb_to_recordset(p_identities) as t(kind text, "groupId" uuid, id text)
       join public.kille_group_players pl on pl.group_id = t."groupId" and pl.id = t.id
       where t.kind = 'player' limit 1),
      (select m.name
       from jsonb_to_recordset(p_identities) as t(kind text, "groupId" uuid, id text)
       join public.kille_group_members m on m.group_id = t."groupId" and m.id::text = t.id
       where t.kind = 'member' limit 1)) into v_name;
  end if;

  if v_person is null then
    if v_name is null then
      raise exception 'PERSON_NAME_REQUIRED' using errcode = '22023';
    end if;
    insert into public.kille_people (display_name) values (v_name) returning id into v_person;
  elsif p_display_name is not null and v_name is not null then
    update public.kille_people set display_name = v_name where id = v_person;
  end if;

  update public.kille_group_players pl set person_id = v_person
  from jsonb_to_recordset(p_identities) as t(kind text, "groupId" uuid, id text)
  where t.kind = 'player' and pl.group_id = t."groupId" and pl.id = t.id;

  update public.kille_group_members m set person_id = v_person
  from jsonb_to_recordset(p_identities) as t(kind text, "groupId" uuid, id text)
  where t.kind = 'member' and m.group_id = t."groupId" and m.id::text = t.id;

  -- Absorbera personer som de valda identiteterna tidigare tillhörde.
  update public.kille_group_players set person_id = v_person
   where person_id = any(v_absorbed) and person_id <> v_person;
  update public.kille_group_members set person_id = v_person
   where person_id = any(v_absorbed) and person_id <> v_person;
  delete from public.kille_people where id = any(v_absorbed) and id <> v_person;

  select count(*) into v_count from (
    select 1 from public.kille_group_players where person_id = v_person
    union all
    select 1 from public.kille_group_members where person_id = v_person) s;

  perform public._kille_log(null, null, p_username, 'people_merged', 'admin',
    jsonb_build_object('personId', v_person, 'name', v_name, 'identities', v_count));

  return jsonb_build_object(
    'ok', true, 'personId', v_person, 'identities', v_count,
    'displayName', (select display_name from public.kille_people where id = v_person));
end;
$$;

-- Byt visningsnamn på en sammanslagen person.
create or replace function public.kille_sa_rename_person(
  p_username text, p_password text, p_person_id uuid, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  perform public._kille_require_sa(p_username, p_password);
  if v_name is null then
    raise exception 'PERSON_NAME_REQUIRED' using errcode = '22023';
  end if;
  update public.kille_people set display_name = v_name where id = p_person_id;
  return jsonb_build_object('ok', true, 'displayName', v_name);
end;
$$;

-- Dela upp en person igen: identiteterna blir fristående, inget annat ändras.
create or replace function public.kille_sa_split_person(
  p_username text, p_password text, p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._kille_require_sa(p_username, p_password);
  update public.kille_group_players set person_id = null where person_id = p_person_id;
  update public.kille_group_members set person_id = null where person_id = p_person_id;
  delete from public.kille_people where id = p_person_id;
  perform public._kille_log(null, null, p_username, 'people_split', 'admin',
    jsonb_build_object('personId', p_person_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Koppla loss EN identitet från sin person. Blir det färre än två identiteter
-- kvar tas personen bort helt — en person med en enda identitet är ingen
-- sammanslagning.
create or replace function public.kille_sa_unlink_identity(
  p_username text, p_password text, p_kind text, p_group_id uuid, p_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_person uuid;
  v_left   int;
begin
  perform public._kille_require_sa(p_username, p_password);

  if p_kind = 'player' then
    select person_id into v_person from public.kille_group_players
     where group_id = p_group_id and id = p_id;
    update public.kille_group_players set person_id = null
     where group_id = p_group_id and id = p_id;
  elsif p_kind = 'member' then
    select person_id into v_person from public.kille_group_members
     where group_id = p_group_id and id::text = p_id;
    update public.kille_group_members set person_id = null
     where group_id = p_group_id and id::text = p_id;
  else
    raise exception 'INVALID_IDENTITY_KIND' using errcode = '22023';
  end if;

  if v_person is null then
    return jsonb_build_object('ok', true, 'personId', null);
  end if;

  select count(*) into v_left from (
    select 1 from public.kille_group_players where person_id = v_person
    union all
    select 1 from public.kille_group_members where person_id = v_person) s;

  if v_left < 2 then
    update public.kille_group_players set person_id = null where person_id = v_person;
    update public.kille_group_members set person_id = null where person_id = v_person;
    delete from public.kille_people where id = v_person;
    return jsonb_build_object('ok', true, 'personId', v_person, 'removed', true);
  end if;

  return jsonb_build_object('ok', true, 'personId', v_person, 'identities', v_left);
end;
$$;

-- ─── Rättigheter ─────────────────────────────────────────────────────────────
-- Endast EXECUTE på de publika RPC-funktionerna ges till anon. Interna
-- hjälpfunktioner (_kille_*) exponeras inte.
--
-- OBS: PostgreSQL ger automatiskt EXECUTE till PUBLIC på nya funktioner, och
-- anon ärver den rättigheten. Därför måste PUBLIC också återkallas nedan —
-- annars kunde t.ex. _kille_snapshot() anropas direkt och läsa ut en hel
-- grupps roster och protokoll utan att känna till gruppens join_code.

revoke all on function
  public._kille_group_by_code(uuid, text),
  public._kille_require_admin(uuid, text, text),
  public._kille_generate_join_code(),
  public._kille_snapshot(uuid, text),
  public._kille_upsert_member(uuid, text, text),
  public._kille_slugify(text),
  public._kille_unique_slug(text),
  public._kille_require_sa(text, text),
  public._kille_name_key(text),
  public._kille_player_stats(uuid, text),
  public._kille_log(uuid, uuid, text, text, text, jsonb),
  public._kille_touch_member(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.kille_create_group(text, text, text, text),
  public.kille_join_group(text, text),
  public.kille_get_group_by_slug(text, text),
  public.kille_pull(uuid, text, uuid),
  public.kille_verify_admin(uuid, text, text),
  public.kille_save_player(uuid, text, text, text, uuid, text),
  public.kille_delete_player(uuid, text, text, uuid, text),
  public.kille_save_game(uuid, text, jsonb, uuid, text),
  public.kille_delete_game(uuid, text, text, uuid, text),
  public.kille_save_tournament(uuid, text, jsonb, uuid, text),
  public.kille_delete_tournament(uuid, text, text, uuid, text),
  public.kille_log_activity(uuid, text, uuid, text, jsonb),
  public.kille_leave_group(uuid, text, uuid),
  public.kille_admin_rename_group(uuid, text, text, text),
  public.kille_admin_remove_member(uuid, text, text, uuid),
  public.kille_admin_set_member_role(uuid, text, text, uuid, text),
  public.kille_admin_set_code(uuid, text, text, text),
  public.kille_admin_regenerate_join_code(uuid, text, text),
  public.kille_admin_delete_group(uuid, text, text)
to anon, authenticated;

grant execute on function
  public.kille_sa_exists(),
  public.kille_sa_bootstrap(text, text),
  public.kille_sa_login(text, text),
  public.kille_sa_add_admin(text, text, text, text),
  public.kille_sa_list_groups(text, text),
  public.kille_sa_usage_overview(text, text),
  public.kille_sa_activity_feed(text, text, int, timestamptz, uuid, text),
  public.kille_sa_create_group(text, text, text, text, text),
  public.kille_sa_rename_group(text, text, uuid, text),
  public.kille_sa_set_slug(text, text, uuid, text),
  public.kille_sa_regen_code(text, text, uuid),
  public.kille_sa_delete_group(text, text, uuid),
  public.kille_sa_list_users(text, text, uuid),
  public.kille_sa_remove_member(text, text, uuid, uuid),
  public.kille_sa_remove_player(text, text, uuid, text),
  public.kille_sa_group_detail(text, text, uuid),
  public.kille_sa_list_people(text, text),
  public.kille_sa_merge_people(text, text, jsonb, text, uuid),
  public.kille_sa_rename_person(text, text, uuid, text),
  public.kille_sa_split_person(text, text, uuid),
  public.kille_sa_unlink_identity(text, text, text, uuid, text)
to anon, authenticated;
