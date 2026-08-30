# Kille Poängräknare

A digital, mobile-first scorecard calculator for the classic Swedish card game **Kille**. It features a vintage-themed interface, a zero-sum scoring engine, automatic calculation of multi-player matches, a stand-by (vilande) system, and persistent game history. 

Designed to be resilient, it works fully offline via a Progressive Web App (PWA) architecture.

## Key Features

- **Groups & shared central database**: On first launch you choose whether to **log in to a group** (shared roster, protocols and statistics via a central Supabase database) or **work locally** (everything stays on the device). Group members share a common game database in real time, and a **group admin** manages the group.
- **2-8 Player Matches**: Manage player rosters with avatars and multi-game persistence.
- **Tournaments**: Run a tournament over several rounds, each splitting the participants across
  parallel tables of 4–7 players. Draw the tables at random, with a *smart* draw that avoids
  repeat meetings, or by hand. The tournament table sums the Kille scores from every table, and
  the tournament is decided either by that table or by a final between the top-ranked players.
- **Automated Score Logic**: Handles Kille's unique zero-sum "pot" distribution, assigning the pot value to the winner and subtracting exact card values from losing players.
- **Stand-by (Vilande) Mechanics**: Players can sit out during specific rounds, automatically registering a zero score for that round.
- **Offline Capable**: Fully functional without network connectivity. Load it once and keep it on your home screen forever.
- **Game History**: Complete history metrics outlining rounds played, cumulative score progressions, and game lifetime statistics.

## Tech Stack

- **Language**: Vanilla JavaScript (ES6+ Modules)
- **Markup**: HTML5
- **Styling**: Vanilla CSS3 (Custom Properties, Grid/Flexbox)
- **Persistance**: `localStorage` (local mode) + **Supabase / PostgreSQL** (group mode)
- **Tests**: Node's built-in `assert` — `npm test`
- **Offline Capabilities**: Service Worker API & Web App Manifest (group mode stays usable offline via a local cache + outgoing sync queue)

## Prerequisites

No compilation tools, bundlers, or package managers are strictly required. You only need:
- A modern web browser.
- A basic local development server (to bypass CORS restrictions for ES modules).

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/user/kille-score-calculator.git
cd kille-score-calculator
```

### 2. Start a Local Development Server

Since the app uses native ES modules (`<script type="module">`), opening `index.html` directly from the filesystem (`file://`) will not work due to CORS policies. You must run a local HTTP server:

**Using Node.js (npx/serve):**
```bash
npx serve .
```

**Using Python:**
```bash
python3 -m http.server 8000
```

**Using PHP:**
```bash
php -S localhost:8000
```

### 3. Open in Browser

Open your browser and navigate to the address logged in your terminal (typically `http://localhost:3000` or `http://localhost:8000`).

## Architecture

The project relies on clean separation of concerns without relying on bulky frontend frameworks.

### Directory Structure

```text
├── assets/
│   └── cards/          # Image assets for card definitions
├── css/
│   └── style.css       # Complete design system & custom properties
├── js/
│   ├── app.js          # Global app controller: Navigation, UI updates, DOM events
│   ├── game.js         # State engine and scoring algorithms
│   ├── tournament.js   # Tournament domain: draws, tables, standings, result
│   └── cards.js        # Kille card dictionary (points, names, types)
├── index.html          # Application UI shell
├── manifest.json       # PWA Manifest
└── sw.js               # Service Worker for offline caching
```

### Core Components

**1. Data Persistence (`js/game.js`)**  
Stores player identities and entire game states (arrays of rounds) asynchronously into `localStorage`. 

**2. Scoring Engine (`calculateScoreTable`)**  
A pure functional engine inside `js/game.js` that receives a game object containing raw round input data, and produces a finalized "score table". It maps all standing round states and extracts lifetime total metrics. The scoring relies on Kille's zero-sum dynamic.

**3. State Management & Navigation (`js/app.js`)**  
Follows a simple `navigateTo(screenId)` SPA pattern. Instead of a virtual DOM, it explicitly controls toggling of `.screen.active` CSS classes and delegates event listeners broadly to handle clicks.

**4. PWA Pipeline (`sw.js` & `manifest.json`)**  
Employs a "stale-while-revalidate" offline strategy. On installation, all UI core files (including card images) are precached. During subsequent loads, requests are served immediately from the Service Worker cache while a fresh copy is fetched in the background and stored for next time, allowing instant, offline boot-ups that still pick up updates.

## Tournaments

A tournament ("turnering") groups a set of participants and is played over several
**rounds**. Each round splits the players who take part into one or more **tables** of
4–7 players, and every table is played as an ordinary Kille protocol — so tournament
games show up in the normal history and statistics, tagged with the tournament they
belong to.

**Creating a round.** When a round is drawn you choose who plays and how the tables are
put together:

| Method | What it does |
| --- | --- |
| **Slump** | Draws the participants freely across the tables. |
| **Smart slump** | Draws so that players who have met the least end up at the same table (and, when only some participants play, prefers those with the fewest tables so far). |
| **Urval** | You place the players yourself — tap a player in the preview to move them to the next table. |
| **Final** | Seeds a single table with the top *N* of the standings; *N* is chosen when the final is drawn. |

The number of tables is suggested automatically (the fewest tables that keep every table
within 4–7 players) and can be adjusted by hand; a table always holds 2–8 players, the
range a Kille game allows.

**The table.** The standings sum each participant's final score from every table they
have played, and that sum is what the tournament is ranked by. Tables played, tables won,
rounds played and rounds won are shown alongside it, and every column is sortable.

**The result.** A tournament played without a final is decided by the standings. Draw a
final and the placement in that final decides instead — the finalists are ranked by their
final score, everyone else follows in table order. Closing the tournament shows the
podium and states which of the two decided it.

Tournaments are stored like games: in `localStorage` in local mode, and in the shared
`kille_group_tournaments` table (via `kille_save_tournament` / `kille_delete_tournament`)
in group mode. They are included in export/import files as well. To enable tournaments on
an existing group database, re-run [`supabase/schema.sql`](supabase/schema.sql) — it is
idempotent and adds the table and functions in place.

## Groups & Central Database (Supabase)

The app runs in one of two modes, chosen on the start screen ("Vill du logga in i
en grupp eller arbeta lokalt?"):

- **Local mode** — all players, games and statistics live in `localStorage` on the
  device only. No account, no network. This is the original behaviour.
- **Group mode** — a group shares one central database. Any member can add players,
  record games and see everyone's statistics. Data is cached locally so the app keeps
  working offline; changes queue up and sync automatically when back online.

Each group has its own **name and slug** (e.g. `gustavsson-and-friends`) and a
**shareable URL** — `/?g=gustavsson-and-friends` (works on any static host) or the
prettier `/g/gustavsson-and-friends` (Vercel rewrite, see `vercel.json`). Opening a
group URL takes you straight into that group.

### Roles

- **Member** — logs in with the group's **join code** (or a group URL) and can
  read/write the shared roster and games.
- **Group admin** — additionally holds the group's secret **admin code** and can rename
  the group, change its slug/URL, regenerate the join code, promote/remove members,
  change the admin code, and delete the group. The person who creates a group becomes
  its first admin.
- **Super-admin** — a global operator with a **username + password** that manages *all*
  groups and users from a console at `/?admin=1` (or `/admin`): create/rename/delete
  groups, change slugs, regenerate codes, and remove members/players in any group. The
  first super-admin is created (bootstrapped) from the login screen when none exists.
  The console also has a **Användning (Usage)** tab — a platform-wide activity monitor
  (see below).

### Usage activity monitoring

The super-admin console includes a platform-wide **usage dashboard** (the *Användning*
tab). It surfaces, across all groups:

- **KPI tiles** — total/active groups, total/active members (7-day), games, and event
  counts (today / 7 d / 30 d).
- **A 30-day events-per-day chart**.
- **A named activity feed** — recent events with who did what, in which group, and when,
  filterable by event type.
- **Per-group usage** on the group list — last-active time, active members and events in
  the last 7 days.

Activity is captured three ways, all writing to the append-only `kille_activity` table:

1. **Data & session events** are logged automatically inside the existing
   `SECURITY DEFINER` RPCs — logins/joins, games saved/deleted, players added/removed,
   member leaves and admin actions. These are tamper-resistant (the client cannot forge
   them) and attributed to the acting member by name.
2. **Member "last seen"** — every write and every `kille_pull` heartbeat bumps
   `kille_group_members.last_seen_at`, powering the "active members" metrics.
3. **Product analytics** — the client ([`js/analytics.js`](js/analytics.js)) batches
   lightweight in-app usage (screen views, feature usage, PWA installs) and sends them via
   `kille_log_activity`. The queue is offline-tolerant (like the sync `Outbox`) and only
   runs in **group mode** — in local mode nothing ever leaves the device.

Only the super-admin can read the activity log (via `kille_sa_usage_overview` and
`kille_sa_activity_feed`). To enable it on an existing database, just re-run
[`supabase/schema.sql`](supabase/schema.sql) — it is idempotent and adds the new table,
column and functions in place.

### One-time setup

1. Create a Supabase project (or use an existing one).
2. Open the **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql). It is
   idempotent (all objects are prefixed `kille_`) and creates the tables, Row Level
   Security policies and the `kille_*` RPC functions used by the client.
3. Put your project's **URL** and **public anon key** in [`js/config.js`](js/config.js)
   (or override per device via the `kille_supabase_url` / `kille_supabase_key`
   `localStorage` keys). They can also be left at their committed defaults.
4. *(Optional)* Seed the example group with
   [`supabase/seed-gustavsson-and-friends.sql`](supabase/seed-gustavsson-and-friends.sql).
   It creates the group `gustavsson-and-friends` and fills it with the players and games
   from the exported data file, so that file's data belongs to that group. The admin
   code is set to `CHANGE-ME-NOW` — change it in the app (Grupp → Administration → Byt
   admin-kod) or from the super-admin console.

> **Security:** the client only ever uses the **public anon key**. Never put the
> `service_role` or `secret` key in the frontend. All tables have RLS enabled with no
> direct anon access — every operation goes through `SECURITY DEFINER` functions that
> require the group's `join_code` (and, for admin actions, the hashed `admin_code`).
> This gives a sensible protection level for a party game without requiring e-mail
> logins.

### How it works in the client

| File | Responsibility |
| --- | --- |
| `js/config.js` | Public Supabase URL + anon key |
| `js/supabase.js` | Tiny dependency-free RPC client over `fetch` |
| `js/session.js` | Tracks local vs. group mode and the current group/role/slug |
| `js/router.js` | Reads the group slug / admin flag from the URL and builds shareable group URLs |
| `js/remote.js` | Group login/admin + super-admin operations + an offline-tolerant outgoing sync queue (`Outbox`) |
| `js/store.js` | Namespaced persistence: local keys vs. per-group keys, enqueuing changes to the central DB in group mode |
| `js/tournament.js` | Tournament domain logic: draws, table splits, standings and result (no DOM, no storage) |

## Deployment

Since this is a static client-side application without a build step or backend, deployment is remarkably straightforward.

### Vercel / Netlify / Cloudflare Pages

1. Connect your GitHub repository to your preferred hosting provider.
2. Ensure the **Build Command** is empty.
3. Ensure the **Output Directory** is set to the repository root directory (`.`).
4. Simply deploy.

### GitHub Pages

You can directly serve the base directory via GitHub Pages. Ensure you configure it to use the "root" folder of the `main` branch.

### Manual Server/Docker

To host via Nginx or Apache, just put the files in your `public_html/` or `/var/www/html/` directory.

If you prefer a Dockerised approach:
```dockerfile
# Dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```
```bash
docker build -t kille-app .
docker run -p 8080:80 kille-app
```
