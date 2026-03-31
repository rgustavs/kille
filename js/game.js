/**
 * Kille Game Engine
 * Pure functional domain logic for game rules, state progression, and scoring.
 * Does not handle persistence or side effects.
 */
import { getCardById } from './cards.js';

/**
 * Utility function to generate a unique ID.
 */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Create a new game with selected player IDs.
 * @param {string[]} playerIds - Array of player IDs (2-8)
 * @returns {object} The initial game object state
 */
export function createGame(playerIds) {
  if (playerIds.length < 2 || playerIds.length > 8) {
    throw new Error('Kille kräver 2-8 spelare');
  }
  return {
    id: uid(),
    playerIds: [...playerIds],
    rounds: [],
    createdAt: new Date().toISOString(),
    status: 'active' // 'active' | 'completed'
  };
}

/**
 * Add a round to a game. Returns a new game object (immutable update).
 * @param {object} game - The current game state
 * @param {object} roundData - { winnerId, standByIds, losers: [{playerId, cardId, neken}] }
 * @returns {object} The updated game state
 */
export function addRound(game, roundData) {
  const { winnerId, standByIds = [], losers = [] } = roundData;

  // Calculate winner score = sum of all loser card points (neken = doubled)
  let winnerScore = 0;
  const loserEntries = losers.map(l => {
    const card = getCardById(l.cardId);
    const points = card ? card.points : 0;
    const actualPoints = l.neken ? points * 2 : points;
    winnerScore += actualPoints;
    return { playerId: l.playerId, cardId: l.cardId, score: -actualPoints, neken: l.neken || false };
  });

  const round = {
    roundNumber: game.rounds.length + 1,
    winnerId,
    winnerScore: winnerScore,
    standByIds: [...standByIds],
    losers: loserEntries,
    timestamp: new Date().toISOString()
  };

  return {
    ...game,
    rounds: [...game.rounds, round]
  };
}

/**
 * Remove the last round (undo). Returns a new game object.
 * @param {object} game - The current game state
 * @returns {object} The updated game state
 */
export function removeLastRound(game) {
  if (game.rounds.length === 0) {
    return game;
  }
  return {
    ...game,
    rounds: game.rounds.slice(0, -1)
  };
}

/**
 * Complete a game. Returns a new game object.
 * @param {object} game - The current game state
 * @returns {object} The updated game state
 */
export function completeGame(game) {
  return {
    ...game,
    status: 'completed',
    completedAt: new Date().toISOString()
  };
}

/**
 * Calculate the score table for a game.
 * Returns an object: { rounds: [{ roundNumber, scores: { [playerId]: { roundScore, runningTotal, cardId?, isWinner, isStandBy } } }] }
 * @param {object} game - The current game state
 * @returns {object} The calculated score table and running totals
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
      scores[l.playerId].neken = l.neken || false;
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
 * Refactored to accept data as parameters rather than reading from a global store.
 * @param {object[]} games - Array of all game objects
 * @param {object[]} players - Array of all player objects
 * @returns {object} Player statistics dictionary keyed by player ID
 */
export function getPlayerStats(games, players) {
  const stats = {};

  players.forEach(p => {
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
