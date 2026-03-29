/**
 * Kille Game Engine
 * Handles player persistence, game state, scoring, and storage.
 */
import { getCardById } from './cards.js';

// ─── Utility ────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Player Store (persistent across games) ─────────────────────────────────
const PLAYERS_KEY = 'kille_players';

export const PlayerStore = {
  _cache: null,

  getAll() {
    if (!this._cache) {
      this._cache = JSON.parse(localStorage.getItem(PLAYERS_KEY) || '[]');
    }
    return this._cache;
  },

  _save() {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(this._cache));
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

// ─── Game Store (save/load games) ────────────────────────────────────────────
const GAMES_KEY = 'kille_games';
const ACTIVE_KEY = 'kille_active_game_id';

export const GameStore = {
  _cache: null,

  getAll() {
    if (!this._cache) {
      this._cache = JSON.parse(localStorage.getItem(GAMES_KEY) || '[]');
    }
    return this._cache;
  },

  _save() {
    localStorage.setItem(GAMES_KEY, JSON.stringify(this._cache));
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
    return localStorage.getItem(ACTIVE_KEY) || null;
  },

  setActive(id) {
    localStorage.setItem(ACTIVE_KEY, id);
  },

  clearActive() {
    localStorage.removeItem(ACTIVE_KEY);
  },

  getActive() {
    const id = this.getActiveId();
    return id ? this.get(id) : null;
  }
};

// ─── Game Engine ─────────────────────────────────────────────────────────────

/**
 * Create a new game with selected player IDs.
 * @param {string[]} playerIds - Array of player IDs (2-8)
 * @returns {object} game object
 */
export function createGame(playerIds) {
  if (playerIds.length < 2 || playerIds.length > 8) {
    throw new Error('Kille kräver 2-8 spelare');
  }
  const game = {
    id: uid(),
    playerIds: [...playerIds],
    rounds: [],
    createdAt: new Date().toISOString(),
    status: 'active' // 'active' | 'completed'
  };
  GameStore.save(game);
  GameStore.setActive(game.id);
  return game;
}

/**
 * Add a round to a game.
 * @param {object} game
 * @param {object} roundData - { winnerId, standByIds, losers: [{playerId, cardId}] }
 * @returns {object} the updated game
 */
export function addRound(game, roundData) {
  const { winnerId, standByIds = [], losers = [] } = roundData;

  // Calculate winner score = sum of all loser card points
  let winnerScore = 0;
  const loserEntries = losers.map(l => {
    const card = getCardById(l.cardId);
    const points = card ? card.points : 0;
    winnerScore += points;
    return { playerId: l.playerId, cardId: l.cardId, score: -points };
  });

  const round = {
    roundNumber: game.rounds.length + 1,
    winnerId,
    winnerScore: winnerScore,
    standByIds: [...standByIds],
    losers: loserEntries,
    timestamp: new Date().toISOString()
  };

  game.rounds.push(round);
  GameStore.save(game);
  return game;
}

/**
 * Remove the last round (undo).
 */
export function removeLastRound(game) {
  if (game.rounds.length > 0) {
    game.rounds.pop();
    GameStore.save(game);
  }
  return game;
}

/**
 * Complete a game.
 */
export function completeGame(game) {
  game.status = 'completed';
  game.completedAt = new Date().toISOString();
  GameStore.save(game);
  GameStore.clearActive();
  return game;
}

/**
 * Calculate the score table for a game.
 * Returns an object: { rounds: [{ roundNumber, scores: { [playerId]: { roundScore, runningTotal, cardId?, isWinner, isStandBy } } }] }
 */
export function calculateScoreTable(game) {
  const runningTotals = {};
  game.playerIds.forEach(pid => { runningTotals[pid] = 0; });

  const rounds = game.rounds.map(round => {
    const scores = {};

    // Initialize all players
    game.playerIds.forEach(pid => {
      scores[pid] = { roundScore: 0, runningTotal: 0, cardId: null, isWinner: false, isStandBy: false };
    });

    // Stand-by players
    round.standByIds.forEach(pid => {
      scores[pid].isStandBy = true;
      scores[pid].roundScore = 0;
    });

    // Winner
    scores[round.winnerId].isWinner = true;
    scores[round.winnerId].roundScore = round.winnerScore;

    // Losers
    round.losers.forEach(l => {
      scores[l.playerId].roundScore = l.score;
      scores[l.playerId].cardId = l.cardId;
    });

    // Update running totals
    game.playerIds.forEach(pid => {
      runningTotals[pid] += scores[pid].roundScore;
      scores[pid].runningTotal = runningTotals[pid];
    });

    return {
      roundNumber: round.roundNumber,
      timestamp: round.timestamp,
      scores
    };
  });

  return { rounds, totals: { ...runningTotals } };
}

/**
 * Get lifetime stats for all players.
 */
export function getPlayerStats() {
  const games = GameStore.getAll();
  const stats = {};

  PlayerStore.getAll().forEach(p => {
    stats[p.id] = { gamesPlayed: 0, roundsPlayed: 0, totalScore: 0, roundsWon: 0, gamesWon: 0 };
  });

  games.forEach(game => {
    const table = calculateScoreTable(game);
    const gamePlayers = game.playerIds.filter(pid => stats[pid]);

    gamePlayers.forEach(pid => {
      stats[pid].gamesPlayed++;
      stats[pid].totalScore += table.totals[pid] || 0;
    });

    // Count rounds
    game.rounds.forEach(round => {
      gamePlayers.forEach(pid => {
        if (!round.standByIds.includes(pid)) {
          stats[pid].roundsPlayed++;
        }
      });
      if (stats[round.winnerId]) {
        stats[round.winnerId].roundsWon++;
      }
    });

    // Determine game winner (highest total)
    if (game.status === 'completed' && gamePlayers.length > 0) {
      let maxScore = -Infinity;
      let winnerId = null;
      gamePlayers.forEach(pid => {
        const score = table.totals[pid] || 0;
        if (score > maxScore) {
          maxScore = score;
          winnerId = pid;
        }
      });
      if (winnerId && stats[winnerId]) {
        stats[winnerId].gamesWon++;
      }
    }
  });

  return stats;
}
