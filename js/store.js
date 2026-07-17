/**
 * Kille Infrastructure — LocalStorage Store
 * Handles persistence for players and games.
 */
import { uid } from './util.js';

// ─── Player Store ───────────────────────────────────────────────────────────
const PLAYERS_KEY = 'kille_players';

function readJsonArray(key) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export const PlayerStore = {
  _cache: null,

  /** Drop the in-memory cache so the next read reloads from localStorage. */
  invalidate() {
    this._cache = null;
  },

  getAll() {
    if (!this._cache) {
      this._cache = readJsonArray(PLAYERS_KEY);
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
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('Spelarnamn saknas');
    }
    const players = this.getAll();
    const player = { id: uid(), name: trimmedName, createdAt: new Date().toISOString() };
    players.push(player);
    this._save();
    return player;
  },

  remove(id) {
    this._cache = this.getAll().filter(p => p.id !== id);
    this._save();
  },

  rename(id, newName) {
    const trimmedName = String(newName || '').trim();
    if (!trimmedName) return;
    const player = this.get(id);
    if (player) {
      player.name = trimmedName;
      this._save();
    }
  }
};

// ─── Game Store ─────────────────────────────────────────────────────────────
const GAMES_KEY = 'kille_games';
const ACTIVE_KEY = 'kille_active_game_id';

export const GameStore = {
  _cache: null,

  /** Drop the in-memory cache so the next read reloads from localStorage. */
  invalidate() {
    this._cache = null;
  },

  getAll() {
    if (!this._cache) {
      this._cache = readJsonArray(GAMES_KEY);
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
    const game = id ? this.get(id) : null;
    if (game && game.status === 'active') return game;
    if (id) this.clearActive();
    return null;
  }
};
