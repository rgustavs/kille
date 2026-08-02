/**
 * Kille Advanced Analytics Engine
 * Comprehensive statistics computed from game history.
 */
import { getCardById, sortCardsByRank, CARDS } from './cards.js';
import { calculateScoreTable } from './game.js';

/**
 * Head-to-head-posten för en motståndare, skapad vid första mötet.
 * `rounds` räknar omgångar de båda deltog i, `wins`/`losses` bara de omgångar
 * där den ene vann och den andre förlorade.
 */
function opponentRecord(ps, opponentId) {
  if (!ps.opponents[opponentId]) {
    ps.opponents[opponentId] = { rounds: 0, wins: 0, losses: 0 };
  }
  return ps.opponents[opponentId];
}

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
      roundScores: [],    // score from every counted round the player took part in
      currentStreak: { type: null, count: 0 }, // win/loss streak
      longestWinStreak: 0, // longest run of winning games ever
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
      id: c.id,
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
      // A non-counted round leaves the standings untouched, so it stays out
      // of the score distributions as well.
      const counted = round.counted !== false;

      // Track round participation
      const participants = [];
      gamePlayers.forEach(pid => {
        if (round.standByIds.includes(pid)) {
          playerStats[pid].roundsStandBy++;
          return;
        }
        playerStats[pid].roundsPlayed++;
        participants.push(pid);
      });

      // Omgångar spelade tillsammans — varje par som båda satt med i omgången,
      // oavsett vem som vann. Vilande spelare räknas inte.
      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          opponentRecord(playerStats[participants[i]], participants[j]).rounds++;
          opponentRecord(playerStats[participants[j]], participants[i]).rounds++;
        }
      }

      // Winner stats
      if (playerStats[round.winnerId]) {
        const ps = playerStats[round.winnerId];
        ps.roundsWon++;
        if (counted) ps.roundScores.push(round.winnerScore);
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
        if (counted) ps.roundScores.push(l.score);

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

          opponentRecord(playerStats[winnerId], l.playerId).wins++;
          opponentRecord(playerStats[l.playerId], winnerId).losses++;
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
    let longestWin = 0;
    sorted.forEach(h => {
      // Determine if this was a "win" game (positive score) or "loss" (negative)
      const type = h.score > 0 ? 'win' : h.score < 0 ? 'loss' : 'draw';
      if (type === streak.type) {
        streak.count++;
      } else {
        streak = { type, count: 1 };
      }
      if (streak.type === 'win' && streak.count > longestWin) {
        longestWin = streak.count;
      }
    });
    ps.currentStreak = streak;
    ps.longestWinStreak = longestWin;
  });

  // Every score ever recorded, across all players — the basis for the
  // overall score distributions.
  const scores = { roundScores: [], gameScores: [] };
  players.forEach(p => {
    const ps = playerStats[p.id];
    if (!ps) return;
    ps.roundScores.forEach(s => scores.roundScores.push(s));
    ps.scoreHistory.forEach(h => scores.gameScores.push(h.score));
  });

  // Records
  const records = computeRecords(playerStats, players);

  return { players: playerStats, cards: cardStats, records, scores };
}

/** Width of a histogram bucket, in points. */
export const HISTOGRAM_BUCKET_SIZE = 20;

/**
 * Bucket one or more score series into a shared histogram, so the series can
 * be compared column by column. Bucket edges are aligned on zero, so no
 * bucket straddles it and every bucket is either entirely a win or a loss.
 *
 * Series are compared by frequency: each bucket carries the share (in percent)
 * of that series' own values, which makes a single player comparable to the
 * much larger overall distribution.
 *
 * @param {object[]} series - [{ key, values: number[] }], first is the primary
 * @param {object} [options] - { bucketSize }
 * @returns {object|null} { bucketSize, buckets, series, maxShare }
 */
export function buildHistogram(series, { bucketSize = HISTOGRAM_BUCKET_SIZE } = {}) {
  const populated = (series || []).filter(s => Array.isArray(s.values) && s.values.length > 0);
  if (populated.length === 0) return null;

  const summaries = populated.map(s => {
    let min = s.values[0];
    let max = s.values[0];
    let sum = 0;
    s.values.forEach(v => {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    });
    return {
      key: s.key,
      label: s.label || s.key,
      total: s.values.length,
      min,
      max,
      average: Math.round(sum / s.values.length * 10) / 10,
    };
  });

  // One shared bucket range covering every series.
  const firstIndex = Math.floor(Math.min(...summaries.map(s => s.min)) / bucketSize);
  const lastIndex = Math.floor(Math.max(...summaries.map(s => s.max)) / bucketSize);
  const buckets = [];
  for (let i = firstIndex; i <= lastIndex; i++) {
    buckets.push({ from: i * bucketSize, to: (i + 1) * bucketSize, values: {} });
  }
  buckets.forEach(b => populated.forEach(s => { b.values[s.key] = { count: 0, share: 0 }; }));

  populated.forEach(s => {
    s.values.forEach(v => {
      const bucket = buckets[Math.floor(v / bucketSize) - firstIndex];
      if (bucket) bucket.values[s.key].count++;
    });
  });

  let maxShare = 0;
  buckets.forEach(b => {
    summaries.forEach(s => {
      const entry = b.values[s.key];
      entry.share = Math.round(entry.count / s.total * 1000) / 10;
      if (entry.share > maxShare) maxShare = entry.share;
    });
  });

  return { bucketSize, buckets, series: summaries, maxShare };
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
    if (ps.longestWinStreak > 0) {
      records.longestWinStreak = updateRecord(records.longestWinStreak, { playerId: p.id, name: p.name }, ps.longestWinStreak, true);
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
 * Get every card in canonical display order (Harlekin first, Blaren last).
 * The whole deck is always returned so no card can drop out of the statistics.
 */
export function getCardsInDisplayOrder(cardStats) {
  return sortCardsByRank(Object.values(cardStats));
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
