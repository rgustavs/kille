/**
 * Kille Advanced Analytics Engine
 * Comprehensive statistics computed from game history.
 */
import { getCardById, CARDS } from './cards.js';
import { calculateScoreTable } from './game.js';

/**
 * Compute advanced statistics across all games for all players.
 * @param {object[]} games - All games from GameStore
 * @param {object[]} players - All players from PlayerStore
 * @returns {object} { players: {}, cards: {}, records: {}, headToHead: {} }
 */
export function computeAdvancedStats(games, players) {
  const completedGames = games.filter(g => g.status === 'completed' && g.rounds.length > 0);

  const playerStats = {};
  players.forEach(p => {
    playerStats[p.id] = {
      name: p.name,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      roundsPlayed: 0,
      roundsWon: 0,
      roundsLost: 0,
      roundsStandBy: 0,
      totalScore: 0,
      bestRoundScore: null,
      worstRoundScore: null,
      bestGameScore: null,
      worstGameScore: null,
      nekenGiven: 0,    // times this player had neken (was the neken loser)
      nekenAsWinner: 0,  // times this player won when someone had neken
      biggestWin: null,   // highest single round win
      cardFrequency: {},  // cardId -> count (as loser)
      winnerCardFrequency: {},  // cardId -> count (as winner)
      scoreHistory: [],   // array of game totals over time
      currentStreak: { type: null, count: 0 }, // win/loss streak
      avgScorePerRound: 0,
      winRate: 0,
      gameWinRate: 0,
      opponents: {},      // opponentId -> { wins, losses }
    };
  });

  // Card statistics
  const cardStats = {};
  CARDS.forEach(c => {
    cardStats[c.id] = {
      name: c.name,
      points: c.points,
      type: c.type,
      timesPlayed: 0,
      timesWithNeken: 0,
      timesWon: 0,          // times this card was played by a winner
      playerFrequency: {},   // playerId -> count (as loser)
      winnerFrequency: {},   // playerId -> count (as winner)
    };
  });

  // Process each game
  completedGames.forEach(game => {
    const table = calculateScoreTable(game);
    const gamePlayers = game.playerIds.filter(pid => playerStats[pid]);

    // Track game scores for each player
    gamePlayers.forEach(pid => {
      playerStats[pid].gamesPlayed++;
      const gameScore = table.totals[pid] || 0;
      playerStats[pid].scoreHistory.push({
        gameId: game.id,
        score: gameScore,
        date: game.createdAt,
        rounds: game.rounds.length,
      });

      if (playerStats[pid].bestGameScore === null || gameScore > playerStats[pid].bestGameScore) {
        playerStats[pid].bestGameScore = gameScore;
      }
      if (playerStats[pid].worstGameScore === null || gameScore < playerStats[pid].worstGameScore) {
        playerStats[pid].worstGameScore = gameScore;
      }
    });

    // Determine game winner and loser
    if (game.status === 'completed' && gamePlayers.length > 0) {
      let maxScore = -Infinity;
      let minScore = Infinity;
      let winnerId = null;

      gamePlayers.forEach(pid => {
        const score = table.totals[pid] || 0;
        if (score > maxScore) { maxScore = score; winnerId = pid; }
        if (score < minScore) { minScore = score; }
      });

      if (winnerId && playerStats[winnerId]) {
        playerStats[winnerId].gamesWon++;
      }

      // Track game losses (worst score)
      gamePlayers.forEach(pid => {
        const score = table.totals[pid] || 0;
        if (score === minScore && pid !== winnerId) {
          playerStats[pid].gamesLost++;
        }
      });
    }

    // Process each round
    game.rounds.forEach(round => {
      // Track round participation
      gamePlayers.forEach(pid => {
        if (round.standByIds.includes(pid)) {
          playerStats[pid].roundsStandBy++;
          return;
        }
        playerStats[pid].roundsPlayed++;
      });

      // Winner stats
      if (playerStats[round.winnerId]) {
        const ps = playerStats[round.winnerId];
        ps.roundsWon++;
        if (ps.bestRoundScore === null || round.winnerScore > ps.bestRoundScore) {
          ps.bestRoundScore = round.winnerScore;
        }
        if (round.losers.some(l => l.neken)) {
          ps.nekenAsWinner++;
        }

        // Winner card frequency
        if (round.winnerCardId) {
          ps.winnerCardFrequency[round.winnerCardId] = (ps.winnerCardFrequency[round.winnerCardId] || 0) + 1;

          // Global card stats for winner cards
          if (cardStats[round.winnerCardId]) {
            cardStats[round.winnerCardId].timesWon++;
            cardStats[round.winnerCardId].winnerFrequency[round.winnerId] =
              (cardStats[round.winnerCardId].winnerFrequency[round.winnerId] || 0) + 1;
          }
        }
      }

      // Loser stats
      round.losers.forEach(l => {
        if (!playerStats[l.playerId]) return;
        const ps = playerStats[l.playerId];
        ps.roundsLost++;

        if (ps.worstRoundScore === null || l.score < ps.worstRoundScore) {
          ps.worstRoundScore = l.score;
        }

        // Card frequency
        if (l.cardId) {
          ps.cardFrequency[l.cardId] = (ps.cardFrequency[l.cardId] || 0) + 1;

          // Global card stats
          if (cardStats[l.cardId]) {
            cardStats[l.cardId].timesPlayed++;
            if (l.neken) cardStats[l.cardId].timesWithNeken++;
            cardStats[l.cardId].playerFrequency[l.playerId] =
              (cardStats[l.cardId].playerFrequency[l.playerId] || 0) + 1;
          }
        }

        if (l.neken) {
          ps.nekenGiven++;
        }
      });

      // Head-to-head: winner vs each loser
      if (playerStats[round.winnerId]) {
        round.losers.forEach(l => {
          if (!playerStats[l.playerId]) return;
          const winnerId = round.winnerId;

          if (!playerStats[winnerId].opponents[l.playerId]) {
            playerStats[winnerId].opponents[l.playerId] = { wins: 0, losses: 0 };
          }
          playerStats[winnerId].opponents[l.playerId].wins++;

          if (!playerStats[l.playerId].opponents[winnerId]) {
            playerStats[l.playerId].opponents[winnerId] = { wins: 0, losses: 0 };
          }
          playerStats[l.playerId].opponents[winnerId].losses++;
        });
      }
    });
  });

  // Calculate derived stats & streaks
  players.forEach(p => {
    const ps = playerStats[p.id];
    if (!ps) return;

    ps.totalScore = ps.scoreHistory.reduce((sum, h) => sum + h.score, 0);
    ps.avgScorePerRound = ps.roundsPlayed > 0 ? Math.round(ps.totalScore / ps.roundsPlayed * 10) / 10 : 0;
    ps.winRate = ps.roundsPlayed > 0 ? Math.round(ps.roundsWon / ps.roundsPlayed * 100) : 0;
    ps.gameWinRate = ps.gamesPlayed > 0 ? Math.round(ps.gamesWon / ps.gamesPlayed * 100) : 0;

    // Biggest single round win
    if (ps.bestRoundScore !== null) {
      ps.biggestWin = ps.bestRoundScore;
    }
  });

  // Calculate streaks from game results in chronological order
  players.forEach(p => {
    const ps = playerStats[p.id];
    if (!ps || ps.scoreHistory.length === 0) return;

    const sorted = [...ps.scoreHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
    let streak = { type: null, count: 0 };
    sorted.forEach(h => {
      // Determine if this was a "win" game (positive score) or "loss" (negative)
      const type = h.score > 0 ? 'win' : h.score < 0 ? 'loss' : 'draw';
      if (type === streak.type) {
        streak.count++;
      } else {
        streak = { type, count: 1 };
      }
    });
    ps.currentStreak = streak;
  });

  // Records
  const records = computeRecords(playerStats, players);

  return { players: playerStats, cards: cardStats, records };
}

/**
 * Compute all-time records.
 */
function computeRecords(playerStats, players) {
  const records = {
    highestRoundScore: null,    // { playerId, score }
    lowestRoundScore: null,     // { playerId, score }
    highestGameScore: null,     // { playerId, score }
    lowestGameScore: null,      // { playerId, score }
    mostGamesWon: null,         // { playerId, count }
    mostRoundsWon: null,        // { playerId, count }
    mostNeken: null,            // { playerId, count }
    longestWinStreak: null,     // { playerId, count }
    mostGamesPlayed: null,      // { playerId, count }
  };

  function updateRecord(current, newEntry, value, isHigher) {
    if (!current) return { holders: [newEntry], value };
    if (value === current.value) {
      return { holders: [...current.holders, newEntry], value: current.value };
    }
    if (isHigher ? value > current.value : value < current.value) {
      return { holders: [newEntry], value };
    }
    return current;
  }

  players.forEach(p => {
    const ps = playerStats[p.id];
    if (!ps || ps.gamesPlayed === 0) return;

    if (ps.bestRoundScore !== null) {
      records.highestRoundScore = updateRecord(records.highestRoundScore, { playerId: p.id, name: p.name }, ps.bestRoundScore, true);
    }
    if (ps.worstRoundScore !== null) {
      records.lowestRoundScore = updateRecord(records.lowestRoundScore, { playerId: p.id, name: p.name }, ps.worstRoundScore, false);
    }
    if (ps.bestGameScore !== null) {
      records.highestGameScore = updateRecord(records.highestGameScore, { playerId: p.id, name: p.name }, ps.bestGameScore, true);
    }
    if (ps.worstGameScore !== null) {
      records.lowestGameScore = updateRecord(records.lowestGameScore, { playerId: p.id, name: p.name }, ps.worstGameScore, false);
    }
    records.mostGamesWon = updateRecord(records.mostGamesWon, { playerId: p.id, name: p.name }, ps.gamesWon, true);
    records.mostRoundsWon = updateRecord(records.mostRoundsWon, { playerId: p.id, name: p.name }, ps.roundsWon, true);
    records.mostNeken = updateRecord(records.mostNeken, { playerId: p.id, name: p.name }, ps.nekenGiven, true);
    if (ps.currentStreak.type === 'win') {
      records.longestWinStreak = updateRecord(records.longestWinStreak, { playerId: p.id, name: p.name }, ps.currentStreak.count, true);
    }
    records.mostGamesPlayed = updateRecord(records.mostGamesPlayed, { playerId: p.id, name: p.name }, ps.gamesPlayed, true);
  });

  return records;
}

/**
 * Get the most frequently won-with card for a player.
 */
export function getMostCommonWinnerCard(playerStat) {
  const entries = Object.entries(playerStat.winnerCardFrequency);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [cardId, count] = entries[0];
  const card = getCardById(cardId);
  return card ? { card, count } : null;
}

/**
 * Get the most frequently lost-with card for a player.
 */
export function getMostCommonCard(playerStat) {
  const entries = Object.entries(playerStat.cardFrequency);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [cardId, count] = entries[0];
  const card = getCardById(cardId);
  return card ? { card, count } : null;
}

/**
 * Get top N cards by play frequency.
 */
export function getTopCards(cardStats, n = 5) {
  return Object.values(cardStats)
    .filter(c => c.timesPlayed > 0)
    .sort((a, b) => b.points - a.points || b.timesPlayed - a.timesPlayed)
    .slice(0, n);
}

/**
 * Get player leaderboard sorted by totalScore, then by gamesPlayed as tiebreaker.
 */
export function getLeaderboard(playerStats) {
  return Object.entries(playerStats)
    .filter(([_, ps]) => ps.gamesPlayed > 0)
    .sort((a, b) => b[1].totalScore - a[1].totalScore || b[1].gamesPlayed - a[1].gamesPlayed)
    .map(([id, ps], rank) => ({ id, rank: rank + 1, ...ps }));
}
