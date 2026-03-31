/**
 * Kille Infrastructure — LocalStorage Store
 * Handles persistence for players and games.
 */

// ─── Utility ────────────────────────────────────────────────────────────────
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Player Store ───────────────────────────────────────────────────────────
const PLAYERS_KEY = 'kille_players';

export const PlayerStore = {
  _cache: null,

  getAll() {
    if (!this._cache) {
      if (typeof localStorage !== 'undefined') {
        this._cache = JSON.parse(localStorage.getItem(PLAYERS_KEY) || '[]');
      } else {
        this._cache = [];
      }
    }
    return this._cache;
  },

  _save() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PLAYERS_KEY, JSON.stringify(this._cache));
    }
  },

  get(id) {
    return this.getAll().find(p => p.id === id) || null;
  },

  add(name) {
    const players = this.getAll();
    const player = { id: uid(), name: name.trim(), createdAt: new Date().toISOString() };
    players.push(player);
    this._save();
    return player;
  },

  remove(id) {
    this._cache = this.getAll().filter(p => p.id !== id);
    this._save();
  },

  rename(id, newName) {
    const player = this.get(id);
    if (player) {
      player.name = newName.trim();
      this._save();
    }
  }
};

// ─── Game Store ─────────────────────────────────────────────────────────────
const GAMES_KEY = 'kille_games';
const ACTIVE_KEY = 'kille_active_game_id';

export const GameStore = {
  _cache: null,

  getAll() {
    if (!this._cache) {
      if (typeof localStorage !== 'undefined') {
        this._cache = JSON.parse(localStorage.getItem(GAMES_KEY) || '[]');
      } else {
        this._cache = [];
      }
    }
    return this._cache;
  },

  _save() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GAMES_KEY, JSON.stringify(this._cache));
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
  },

  remove(id) {
    this._cache = this.getAll().filter(g => g.id !== id);
    this._save();
    if (this.getActiveId() === id) {
      this.clearActive();
    }
  },

  getActiveId() {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(ACTIVE_KEY) || null;
    }
    return null;
  },

  setActive(id) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_KEY, id);
    }
  },

  clearActive() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ACTIVE_KEY);
    }
  },

  getActive() {
    const id = this.getActiveId();
    return id ? this.get(id) : null;
  }
};
