import assert from 'assert';
import { computeAdvancedStats, getCardsInDisplayOrder, buildHistogram } from '../js/stats.js';
import { CARDS } from '../js/cards.js';

/** Build a completed 2-player game where `winnerId` wins a single round. */
function makeGame(id, dateIso, winnerId, loserId) {
  return {
    id,
    playerIds: [winnerId, loserId],
    status: 'completed',
    createdAt: dateIso,
    rounds: [{
      roundNumber: 1,
      winnerId,
      winnerCardId: 'num_10',
      winnerScore: 50,
      standByIds: [],
      losers: [{ playerId: loserId, cardId: 'num_10', score: -50, neken: false }],
      counted: true,
      timestamp: dateIso
    }]
  };
}

function runTests() {
  console.log('Running stats domain tests...');
  let failures = 0;

  // Test: longestWinStreak reflects the best historical run, not the current one.
  // p1 wins games 1-3, then loses game 4. Current streak is a 1-game loss,
  // but the longest win streak should still be 3.
  try {
    const players = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
    const games = [
      makeGame('g1', '2024-01-01T10:00:00.000Z', 'p1', 'p2'),
      makeGame('g2', '2024-01-02T10:00:00.000Z', 'p1', 'p2'),
      makeGame('g3', '2024-01-03T10:00:00.000Z', 'p1', 'p2'),
      makeGame('g4', '2024-01-04T10:00:00.000Z', 'p2', 'p1'), // p1 loses last
    ];

    const stats = computeAdvancedStats(games, players);
    const p1 = stats.players.p1;

    assert.strictEqual(p1.currentStreak.type, 'loss');
    assert.strictEqual(p1.currentStreak.count, 1);
    assert.strictEqual(p1.longestWinStreak, 3);

    // The record must credit p1 with a streak of 3, not the current 1.
    assert.ok(stats.records.longestWinStreak);
    assert.strictEqual(stats.records.longestWinStreak.value, 3);
    assert.ok(stats.records.longestWinStreak.holders.some(h => h.playerId === 'p1'));
    console.log('✅ longestWinStreak record passes');
  } catch (err) {
    failures++;
    console.error('❌ longestWinStreak record failed', err);
  }

  // Test: the card statistics list covers the whole deck and is always ordered
  // Harlekin first, Blaren last — no card may drop out (Blaren used to be cut).
  try {
    const players = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
    const stats = computeAdvancedStats([makeGame('g1', '2024-01-01T10:00:00.000Z', 'p1', 'p2')], players);
    const list = getCardsInDisplayOrder(stats.cards);

    assert.strictEqual(list.length, CARDS.length);
    assert.strictEqual(list[0].id, 'harlekin');
    assert.strictEqual(list[list.length - 1].id, 'blaren');
    assert.ok(list.some(c => c.id === 'blaren'));
    console.log('✅ card display order passes');
  } catch (err) {
    failures++;
    console.error('❌ card display order failed', err);
  }

  // Test: histogram buckets are aligned on zero, so no bucket mixes wins with
  // losses, and every value lands in exactly one bucket.
  try {
    assert.strictEqual(buildHistogram([]), null);

    const hist = buildHistogram([-70, -50, -5, 0, 5, 50, 215]);
    assert.ok(hist.buckets.every(b => b.from >= 0 || b.to <= 0), 'no bucket straddles zero');
    assert.ok(hist.buckets.some(b => b.from === 0), 'a bucket starts at zero');
    assert.strictEqual(hist.buckets.reduce((sum, b) => sum + b.count, 0), 7);
    assert.strictEqual(hist.total, 7);
    assert.strictEqual(hist.min, -70);
    assert.strictEqual(hist.max, 215);

    // Buckets are contiguous and ordered from the lowest score upwards.
    hist.buckets.forEach((b, i) => {
      assert.strictEqual(b.to - b.from, hist.bucketSize);
      if (i > 0) assert.strictEqual(b.from, hist.buckets[i - 1].to);
    });
    assert.ok(hist.buckets[0].from <= -70 && hist.buckets[hist.buckets.length - 1].to > 215);

    // A single repeated value still produces one bucket holding everything.
    const flat = buildHistogram([25, 25, 25]);
    assert.strictEqual(flat.total, 3);
    assert.strictEqual(flat.maxCount, 3);
    assert.strictEqual(flat.average, 25);
    console.log('✅ score histogram passes');
  } catch (err) {
    failures++;
    console.error('❌ score histogram failed', err);
  }

  // Test: round scores feed the distributions, and a non-counted round is left out.
  try {
    const players = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
    const game = makeGame('g1', '2024-01-01T10:00:00.000Z', 'p1', 'p2');
    game.rounds.push({
      roundNumber: 2, winnerId: 'p1', winnerCardId: 'num_1', winnerScore: 5,
      standByIds: [], counted: false,
      losers: [{ playerId: 'p2', cardId: 'num_1', score: -5, neken: false }],
      timestamp: '2024-01-01T11:00:00.000Z'
    });

    const stats = computeAdvancedStats([game], players);
    assert.deepStrictEqual(stats.players.p1.roundScores, [50]);
    assert.deepStrictEqual(stats.players.p2.roundScores, [-50]);
    assert.deepStrictEqual(stats.scores.roundScores.slice().sort((a, b) => a - b), [-50, 50]);
    assert.deepStrictEqual(stats.scores.gameScores.slice().sort((a, b) => a - b), [-50, 50]);
    console.log('✅ score distributions passes');
  } catch (err) {
    failures++;
    console.error('❌ score distributions failed', err);
  }

  if (failures > 0) {
    console.error(`${failures} test group(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('All tests completed.');
}

runTests();
