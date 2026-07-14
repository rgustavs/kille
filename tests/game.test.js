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
  let failures = 0;

  // Test: createGame
  try {
    const game = createGame(['p1', 'p2', 'p3']);
    assert.strictEqual(game.playerIds.length, 3);
    assert.strictEqual(game.status, 'active');
    assert.strictEqual(game.rounds.length, 0);
    console.log('✅ createGame passes');
  } catch (err) {
    failures++;
    console.error('❌ createGame failed', err);
  }

  // Test: createGame validation
  try {
    assert.throws(() => createGame(['p1']), /2-8/);
    console.log('✅ createGame validation passes');
  } catch (err) {
    failures++;
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
    failures++;
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
    failures++;
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
    failures++;
    console.error('❌ completeGame failed', err);
  }

  // Test: Neken scoring (double the card, floored at 50)
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
    failures++;
    console.error('❌ Neken scoring failed', err);
  }

  // Test: Neken floor — a low card doubled is still at least 50
  try {
    let game = createGame(['p1', 'p2', 'p3']);
    game = addRound(game, {
      winnerId: 'p1',
      losers: [
        { playerId: 'p2', cardId: 'num_2', neken: true }, // 10 * 2 = 20 -> floored to 50
        { playerId: 'p3', cardId: 'num_1', neken: false }  // 5pts
      ]
    });
    const table = calculateScoreTable(game);
    assert.strictEqual(table.totals['p2'], -50); // floor applied
    assert.strictEqual(table.totals['p1'], 55);  // 50 + 5
    console.log('✅ Neken floor passes');
  } catch (err) {
    failures++;
    console.error('❌ Neken floor failed', err);
  }

  // Test: Neken above floor — a high card doubled exceeds 50
  try {
    let game = createGame(['p1', 'p2']);
    game = addRound(game, {
      winnerId: 'p1',
      losers: [{ playerId: 'p2', cardId: 'num_12', neken: true }] // 60 * 2 = 120
    });
    const table = calculateScoreTable(game);
    assert.strictEqual(table.totals['p2'], -120);
    assert.strictEqual(table.totals['p1'], 120);
    console.log('✅ Neken above floor passes');
  } catch (err) {
    failures++;
    console.error('❌ Neken above floor failed', err);
  }

  // Test: Non-counted (low-stake) round updates protocol but not standings
  try {
    let game = createGame(['p1', 'p2', 'p3']);
    // First a normal counted round
    game = addRound(game, {
      winnerId: 'p1',
      losers: [
        { playerId: 'p2', cardId: 'num_10', neken: false }, // 50
        { playerId: 'p3', cardId: 'num_2', neken: false }   // 10
      ]
    });
    // Then a low-stake round the players chose NOT to record in the standings
    game = addRound(game, {
      winnerId: 'p2',
      counted: false,
      losers: [
        { playerId: 'p1', cardId: 'num_1', neken: false }, // 5
        { playerId: 'p3', cardId: 'num_1', neken: false }  // 5
      ]
    });
    const table = calculateScoreTable(game);
    // Standings reflect only the first round; the second leaves them unchanged
    assert.strictEqual(table.totals['p1'], 60);
    assert.strictEqual(table.totals['p2'], -50);
    assert.strictEqual(table.totals['p3'], -10);
    // The round is still recorded in the protocol
    assert.strictEqual(game.rounds.length, 2);
    assert.strictEqual(game.rounds[1].counted, false);
    assert.strictEqual(table.rounds[1].counted, false);
    console.log('✅ Non-counted round passes');
  } catch (err) {
    failures++;
    console.error('❌ Non-counted round failed', err);
  }

  // Test: rounds are counted by default
  try {
    let game = createGame(['p1', 'p2']);
    game = addRound(game, {
      winnerId: 'p1',
      losers: [{ playerId: 'p2', cardId: 'num_2', neken: false }]
    });
    assert.strictEqual(game.rounds[0].counted, true);
    console.log('✅ Default counted passes');
  } catch (err) {
    failures++;
    console.error('❌ Default counted failed', err);
  }

  // Test: invalid round data should fail loudly instead of scoring as zero
  try {
    const game = createGame(['p1', 'p2']);
    assert.throws(() => addRound(game, {
      winnerId: 'p1',
      losers: [{ playerId: 'p2', cardId: 'missing_card', neken: false }]
    }), /kort/);
    assert.throws(() => addRound(game, {
      winnerId: 'missing_player',
      losers: [{ playerId: 'p2', cardId: 'num_2', neken: false }]
    }), /Vinnaren/);
    assert.throws(() => addRound(createGame(['p1', 'p2', 'p3']), {
      winnerId: 'p1',
      losers: [{ playerId: 'p2', cardId: 'num_2', neken: false }]
    }), /Alla aktiva/);
    assert.throws(() => addRound(game, {
      winnerId: 'p1',
      standByIds: ['p2'],
      losers: [{ playerId: 'p2', cardId: 'num_2', neken: false }]
    }), /förlorare/);
    console.log('✅ addRound validation passes');
  } catch (err) {
    failures++;
    console.error('❌ addRound validation failed', err);
  }

  // Test: score table tolerates legacy/incomplete rounds without crashing
  try {
    const table = calculateScoreTable({
      playerIds: ['p1', 'p2'],
      rounds: [{ roundNumber: 1, winnerId: 'p1', winnerScore: 0 }]
    });
    assert.strictEqual(table.totals.p1, 0);
    assert.strictEqual(table.totals.p2, 0);
    console.log('✅ calculateScoreTable legacy tolerance passes');
  } catch (err) {
    failures++;
    console.error('❌ calculateScoreTable legacy tolerance failed', err);
  }

  if (failures > 0) {
    console.error(`${failures} test group(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('All tests completed.');
}

runTests();
