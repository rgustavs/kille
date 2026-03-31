import assert from 'assert';
import {
  createGame,
  addRound,
  removeLastRound,
  completeGame,
  calculateScoreTable,
  uid
} from '../js/game.js';

function runTests() {
  console.log('Running game domain tests...');

  // Test: createGame
  try {
    const game = createGame(['p1', 'p2', 'p3']);
    assert.strictEqual(game.playerIds.length, 3);
    assert.strictEqual(game.status, 'active');
    assert.strictEqual(game.rounds.length, 0);
    console.log('✅ createGame passes');
  } catch (err) {
    console.error('❌ createGame failed', err);
  }

  // Test: createGame validation
  try {
    assert.throws(() => createGame(['p1']), /2-8/);
    console.log('✅ createGame validation passes');
  } catch (err) {
    console.error('❌ createGame validation failed', err);
  }

  // Test: addRound and calculateScoreTable
  try {
    let game = createGame(['p1', 'p2', 'p3']);

    const roundData = {
      winnerId: 'p1',
      standByIds: ['p3'],
      losers: [
        { playerId: 'p2', cardId: 'num_10', neken: false } // 10 = 50 points
      ]
    };

    game = addRound(game, roundData);
    assert.strictEqual(game.rounds.length, 1);

    const table = calculateScoreTable(game);
    // p1 (winner) gets +50, p2 (loser) gets -50, p3 (standby) gets 0
    assert.strictEqual(table.totals['p1'], 50);
    assert.strictEqual(table.totals['p2'], -50);
    assert.strictEqual(table.totals['p3'], 0);
    console.log('✅ addRound and calculateScoreTable passes');
  } catch (err) {
    console.error('❌ addRound and calculateScoreTable failed', err);
  }

  // Test: removeLastRound
  try {
    let game = createGame(['p1', 'p2']);
    game = addRound(game, {
      winnerId: 'p1',
      losers: [{ playerId: 'p2', cardId: 'num_2', neken: false }]
    });
    assert.strictEqual(game.rounds.length, 1);
    game = removeLastRound(game);
    assert.strictEqual(game.rounds.length, 0);
    console.log('✅ removeLastRound passes');
  } catch (err) {
    console.error('❌ removeLastRound failed', err);
  }

  // Test: completeGame
  try {
    let game = createGame(['p1', 'p2']);
    game = completeGame(game);
    assert.strictEqual(game.status, 'completed');
    assert.ok(game.completedAt);
    console.log('✅ completeGame passes');
  } catch (err) {
    console.error('❌ completeGame failed', err);
  }

  // Test: Neken scoring
  try {
    let game = createGame(['p1', 'p2', 'p3']);
    const roundData = {
      winnerId: 'p1',
      losers: [
        { playerId: 'p2', cardId: 'num_5', neken: true }, // num_5 = 25pts * 2 = 50pts
        { playerId: 'p3', cardId: 'num_2', neken: false } // num_2 = 10pts
      ]
    };
    game = addRound(game, roundData);
    const table = calculateScoreTable(game);
    assert.strictEqual(table.totals['p1'], 60); // 50 + 10
    assert.strictEqual(table.totals['p2'], -50);
    assert.strictEqual(table.totals['p3'], -10);
    console.log('✅ Neken scoring passes');
  } catch (err) {
    console.error('❌ Neken scoring failed', err);
  }

  console.log('All tests completed.');
}

runTests();
