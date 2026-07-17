/**
 * Kille Game Engine
 * Pure functional domain logic for game rules, state progression, and scoring.
 * Does not handle persistence or side effects.
 */
import { getCardById } from './cards.js';
import { uid } from './util.js';

export { uid };

/**
 * A "nek" (neken) costs the losing player at least this many points.
 * The penalty is double the card value, but never less than this floor.
 */
export const NEKEN_PENALTY = 50;

/**
 * A round whose pot (winner score) is at or below this threshold may be
 * recorded without affecting the standings (see round.counted).
 */
export const LOW_STAKE_THRESHOLD = 15;

/**
 * Create a new game with selected player IDs.
 * @param {string[]} playerIds - Array of player IDs (2-8)
 * @returns {object} The initial game object state
 */
export function createGame(playerIds) {
  if (!Array.isArray(playerIds)) {
    throw new Error('Spelare måste anges som en lista');
  }
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
 * @param {object} roundData - { winnerId, standByIds, losers: [{playerId, cardId, neken}], counted }
 * @returns {object} The updated game state
 */
export function addRound(game, roundData) {
  if (!game || !Array.isArray(game.playerIds) || !Array.isArray(game.rounds)) {
    throw new Error('Ogiltigt spel');
  }
  const { winnerId, winnerCardId = null, standByIds = [], losers = [], counted = true } = roundData;
  if (!game.playerIds.includes(winnerId)) {
    throw new Error('Vinnaren finns inte i spelet');
  }
  if (!Array.isArray(standByIds) || !Array.isArray(losers)) {
    throw new Error('Ogiltig omgång');
  }
  const standBySet = new Set(standByIds);
  if (standBySet.size !== standByIds.length || standByIds.some(id => !game.playerIds.includes(id))) {
    throw new Error('Ogiltig vilande spelare');
  }
  if (standBySet.has(winnerId)) {
    throw new Error('Vinnaren kan inte vara vilande');
  }
  if (winnerCardId && !getCardById(winnerCardId)) {
    throw new Error('Okänt vinnarkort');
  }

  // Calculate winner score = sum of all loser card points
  // (neken = double the card, but never less than the fixed penalty).
  let winnerScore = 0;
  const loserIds = new Set();
  const loserEntries = losers.map(l => {
    const card = getCardById(l.cardId);
    if (!game.playerIds.includes(l.playerId)) {
      throw new Error('Förloraren finns inte i spelet');
    }
    if (l.playerId === winnerId || standBySet.has(l.playerId) || loserIds.has(l.playerId)) {
      throw new Error('Ogiltig förlorare');
    }
    if (!card) {
      throw new Error('Okänt kort');
    }
    loserIds.add(l.playerId);
    const points = card.points;
    const actualPoints = l.neken ? Math.max(points * 2, NEKEN_PENALTY) : points;
    winnerScore += actualPoints;
    return { playerId: l.playerId, cardId: l.cardId, score: -actualPoints, neken: l.neken || false };
  });
  const expectedLosers = game.playerIds.filter(id => id !== winnerId && !standBySet.has(id));
  if (loserIds.size !== expectedLosers.length) {
    throw new Error('Alla aktiva förlorare måste ha ett kort');
  }

  const round = {
    roundNumber: game.rounds.length + 1,
    winnerId,
    winnerCardId: winnerCardId || null,
    winnerScore: winnerScore,
    standByIds: [...standByIds],
    losers: loserEntries,
    counted: counted !== false,
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
  const playerIds = Array.isArray(game?.playerIds) ? game.playerIds : [];
  const gameRounds = Array.isArray(game?.rounds) ? game.rounds : [];
  playerIds.forEach(pid => { runningTotals[pid] = 0; });

  const rounds = gameRounds.map(round => {
    const scores = {};
    const standByIds = Array.isArray(round.standByIds) ? round.standByIds : [];
    const losers = Array.isArray(round.losers) ? round.losers : [];
    // A round is counted (affects standings) unless explicitly flagged otherwise.
    const counted = round.counted !== false;

    // Initialize all players
    playerIds.forEach(pid => {
      scores[pid] = { roundScore: 0, runningTotal: 0, cardId: null, isWinner: false, isStandBy: false };
    });

    // Stand-by players
    standByIds.forEach(pid => {
      if (!scores[pid]) return;
      scores[pid].isStandBy = true;
      scores[pid].roundScore = 0;
    });

    // Winner
    if (scores[round.winnerId]) {
      scores[round.winnerId].isWinner = true;
      scores[round.winnerId].roundScore = round.winnerScore || 0;
      scores[round.winnerId].cardId = round.winnerCardId || null;
      scores[round.winnerId].hadNeken = losers.some(l => l.neken);
    }

    // Losers
    losers.forEach(l => {
      if (!scores[l.playerId]) return;
      scores[l.playerId].roundScore = Number.isFinite(l.score) ? l.score : 0;
      scores[l.playerId].cardId = l.cardId;
      scores[l.playerId].neken = l.neken || false;
    });

    // Update running totals — a non-counted round leaves the standings unchanged.
    playerIds.forEach(pid => {
      if (counted) {
        runningTotals[pid] += scores[pid].roundScore;
      }
      scores[pid].runningTotal = runningTotals[pid];
    });

    return {
      roundNumber: round.roundNumber,
      timestamp: round.timestamp,
      counted,
      scores
    };
  });

  return { rounds, totals: { ...runningTotals } };
}
