/**
 * Kille Infrastructure — Persistens för spelare och spel.
 *
 * Lagret är läges-medvetet:
 *  - Lokalt läge: allt sparas i localStorage på enheten (som tidigare).
 *  - Grupp-läge: en lokal, grupp-namespacad kopia hålls i localStorage för
 *    snabba, synkrona läsningar och offline-drift, och varje ändring läggs i en
 *    utgående kö (se remote.js) som synkas mot den centrala Supabase-databasen.
 *
 * Läs-API:t är avsiktligt synkront så att hela app-lagret kan fortsätta att
 * fungera oförändrat oavsett läge.
 */
import { uid } from './util.js';
import { Session } from './session.js';
import { Outbox } from './remote.js';

// Nyckelbasen skiljer sig åt mellan lokalt läge och varje grupp.
const LOCAL_KEYS = {
  players: 'kille_players',
  games: 'kille_games',
  active: 'kille_active_game_id'
};

function keyFor(base) {
  if (Session.isGroup()) return `kille_g_${Session.group.id}_${base}`;
  return LOCAL_KEYS[base];
}

function readJsonArray(key) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function inGroup() {
  return Session.isGroup();
}

// Vem gör ändringen? Fångas vid enqueue-tillfället så att köade (offline)
// operationer behåller rätt upphovsperson när de skickas senare.
function actor() {
  return { actorId: Session.memberId, actorName: Session.memberName };
}

// ─── Player Store ───────────────────────────────────────────────────────────
export const PlayerStore = {
  _cache: null,
  _cacheKey: null,

  /** Drop the in-memory cache so the next read reloads from localStorage. */
  invalidate() {
    this._cache = null;
    this._cacheKey = null;
  },

  getAll() {
    const key = keyFor('players');
    if (!this._cache || this._cacheKey !== key) {
      this._cache = readJsonArray(key);
      this._cacheKey = key;
    }
    return this._cache;
  },

  _save() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(keyFor('players'), JSON.stringify(this._cache));
    }
  },

  get(id) {
    return this.getAll().find(p => p.id === id) || null;
  },

  add(name) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('Spelarnamn saknas');
    }
    const players = this.getAll();
    const player = { id: uid(), name: trimmedName, createdAt: new Date().toISOString() };
    players.push(player);
    this._save();
    if (inGroup()) Outbox.enqueue({ type: 'savePlayer', id: player.id, name: player.name, ...actor() });
    return player;
  },

  remove(id) {
    this._cache = this.getAll().filter(p => p.id !== id);
    this._save();
    if (inGroup()) Outbox.enqueue({ type: 'deletePlayer', id, ...actor() });
  },

  rename(id, newName) {
    const trimmedName = String(newName || '').trim();
    if (!trimmedName) return;
    const player = this.get(id);
    if (player) {
      player.name = trimmedName;
      this._save();
      if (inGroup()) Outbox.enqueue({ type: 'savePlayer', id: player.id, name: player.name, ...actor() });
    }
  }
};

// ─── Game Store ─────────────────────────────────────────────────────────────
export const GameStore = {
  _cache: null,
  _cacheKey: null,

  /** Drop the in-memory cache so the next read reloads from localStorage. */
  invalidate() {
    this._cache = null;
    this._cacheKey = null;
  },

  getAll() {
    const key = keyFor('games');
    if (!this._cache || this._cacheKey !== key) {
      this._cache = readJsonArray(key);
      this._cacheKey = key;
    }
    return this._cache;
  },

  _save() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(keyFor('games'), JSON.stringify(this._cache));
    }
  },

  get(id) {
    return this.getAll().find(g => g.id === id) || null;
  },

  save(game) {
    const games = this.getAll();
    const idx = games.findIndex(g => g.id === game.id);
    if (idx >= 0) {
      games[idx] = game;
    } else {
      games.push(game);
    }
    this._save();
    if (inGroup()) Outbox.enqueue({ type: 'saveGame', game, ...actor() });
  },

  remove(id) {
    this._cache = this.getAll().filter(g => g.id !== id);
    this._save();
    if (this.getActiveId() === id) {
      this.clearActive();
    }
    if (inGroup()) Outbox.enqueue({ type: 'deleteGame', id, ...actor() });
  },

  getActiveId() {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(keyFor('active')) || null;
    }
    return null;
  },

  setActive(id) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(keyFor('active'), id);
    }
  },

  clearActive() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(keyFor('active'));
    }
  },

  getActive() {
    const id = this.getActiveId();
    const game = id ? this.get(id) : null;
    if (game && game.status === 'active') return game;
    if (id) this.clearActive();
    return null;
  }
};

// ─── Grupp-hydrering ──────────────────────────────────────────────────────────
/**
 * Skriv en snapshot (retur från join/pull) till den aktuella gruppens lokala
 * kopia och släng cacherna så att appen läser färsk data. Servern är
 * källan till sanning för spelare/spel; eventuella lokalt köade ändringar ligger
 * kvar i outboxen och skickas separat.
 */
export const GroupData = {
  hydrate(snapshot) {
    if (!Session.isGroup() || !snapshot) return;
    const gid = Session.group.id;
    const players = Array.isArray(snapshot.players)
      ? snapshot.players.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt }))
      : [];
    const games = Array.isArray(snapshot.games) ? snapshot.games : [];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`kille_g_${gid}_players`, JSON.stringify(players));
      localStorage.setItem(`kille_g_${gid}_games`, JSON.stringify(games));
    }
    PlayerStore.invalidate();
    GameStore.invalidate();
  }
};
