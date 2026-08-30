import assert from 'assert';
import {
  createTournament,
  addTournamentRound,
  removeTournamentRound,
  completeTournament,
  addParticipants,
  removeParticipant,
  tableCountFor,
  tableSizes,
  tableCountRange,
  drawTables,
  pickPlayers,
  meetingCounts,
  playedCounts,
  computeStandings,
  qualifiers,
  rankedTables,
  tournamentResult,
  getFinalRound,
  tournamentGameIds,
  MIN_TABLE_SIZE,
  MAX_TABLE_SIZE
} from '../js/tournament.js';
import { createGame, addRound } from '../js/game.js';

/** Deterministisk pseudoslump så att lottningstesterna är stabila. */
function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** Ett färdigspelat bord: vinnaren tar hela potten i en enda omgång. */
function playedGame(playerIds, winnerId, cardIds) {
  const game = createGame(playerIds);
  const losers = playerIds
    .filter(id => id !== winnerId)
    .map((id, i) => ({ playerId: id, cardId: cardIds[i], neken: false }));
  return addRound(game, { winnerId, losers });
}

function runTests() {
  console.log('Running tournament domain tests...');
  let failures = 0;

  // Test: createTournament
  try {
    const t = createTournament('  Julturneringen  ', ['p1', 'p2', 'p3']);
    assert.strictEqual(t.name, 'Julturneringen');
    assert.strictEqual(t.playerIds.length, 3);
    assert.strictEqual(t.status, 'active');
    assert.deepStrictEqual(t.rounds, []);
    console.log('✅ createTournament passes');
  } catch (err) {
    failures++;
    console.error('❌ createTournament failed', err);
  }

  // Test: createTournament validation
  try {
    assert.throws(() => createTournament('', ['p1', 'p2']), /namn/);
    assert.throws(() => createTournament('T', ['p1']), /minst 2/);
    assert.throws(() => createTournament('T', ['p1', 'p1']), /en gång/);
    console.log('✅ createTournament validation passes');
  } catch (err) {
    failures++;
    console.error('❌ createTournament validation failed', err);
  }

  // Test: participants
  try {
    let t = createTournament('T', ['p1', 'p2']);
    t = addParticipants(t, ['p2', 'p3']);
    assert.deepStrictEqual(t.playerIds, ['p1', 'p2', 'p3']);
    t = removeParticipant(t, 'p3');
    assert.deepStrictEqual(t.playerIds, ['p1', 'p2']);
    console.log('✅ add/removeParticipants passes');
  } catch (err) {
    failures++;
    console.error('❌ add/removeParticipants failed', err);
  }

  // Test: a participant who has played cannot be removed
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3', 'p4']);
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3', 'p4'] }] });
    assert.throws(() => removeParticipant(t, 'p1'), /redan spelat/);
    console.log('✅ removeParticipant guard passes');
  } catch (err) {
    failures++;
    console.error('❌ removeParticipant guard failed', err);
  }

  // Test: table counts and sizes (4–7 players per table)
  try {
    assert.strictEqual(tableCountFor(6), 1);
    assert.strictEqual(tableCountFor(8), 2);
    assert.strictEqual(tableCountFor(11), 2);
    assert.strictEqual(tableCountFor(15), 3);
    assert.strictEqual(tableCountFor(22), 4);
    assert.deepStrictEqual(tableSizes(8, 2), [4, 4]);
    assert.deepStrictEqual(tableSizes(11, 2), [6, 5]);
    assert.deepStrictEqual(tableSizes(15, 3), [5, 5, 5]);
    // Varje automatiskt val ska hålla sig inom 4–7 spelare per bord.
    for (let n = MIN_TABLE_SIZE; n <= 40; n++) {
      const sizes = tableSizes(n, tableCountFor(n));
      assert.ok(sizes.every(s => s >= MIN_TABLE_SIZE && s <= MAX_TABLE_SIZE),
        `Ogiltiga bordsstorlekar för ${n} spelare: ${sizes}`);
      assert.strictEqual(sizes.reduce((a, b) => a + b, 0), n);
    }
    console.log('✅ tableCountFor/tableSizes passes');
  } catch (err) {
    failures++;
    console.error('❌ tableCountFor/tableSizes failed', err);
  }

  // Test: tableCountRange
  try {
    assert.deepStrictEqual(tableCountRange(12), { min: 2, max: 6 });
    assert.deepStrictEqual(tableCountRange(5), { min: 1, max: 2 });
    console.log('✅ tableCountRange passes');
  } catch (err) {
    failures++;
    console.error('❌ tableCountRange failed', err);
  }

  // Test: random draw uses every player exactly once
  try {
    const ids = Array.from({ length: 13 }, (_, i) => `p${i + 1}`);
    const t = createTournament('T', ids);
    const tables = drawTables(t, ids, { method: 'random', rng: seededRng(7) });
    const flat = tables.flat();
    assert.strictEqual(flat.length, 13);
    assert.strictEqual(new Set(flat).size, 13);
    assert.ok(tables.every(tb => tb.length >= MIN_TABLE_SIZE && tb.length <= MAX_TABLE_SIZE));
    console.log('✅ drawTables random passes');
  } catch (err) {
    failures++;
    console.error('❌ drawTables random failed', err);
  }

  // Test: smart draw avoids repeating the previous round's tables
  try {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    let t = createTournament('T', ids);
    t = addTournamentRound(t, {
      method: 'random',
      tables: [
        { gameId: 'g1', playerIds: ids.slice(0, 6) },
        { gameId: 'g2', playerIds: ids.slice(6) }
      ]
    });
    const tables = drawTables(t, ids, { method: 'smart', rng: seededRng(3) });
    const counts = meetingCounts(t);
    let repeats = 0;
    tables.forEach(tb => {
      for (let i = 0; i < tb.length; i++) {
        for (let j = i + 1; j < tb.length; j++) {
          const key = tb[i] < tb[j] ? `${tb[i]}|${tb[j]}` : `${tb[j]}|${tb[i]}`;
          repeats += counts.get(key) || 0;
        }
      }
    });
    // Två bord om sex av tolv spelare kan alltid delas så att hälften av
    // mötena är nya; en ren slump ger 30 upprepade möten.
    assert.ok(repeats < 30, `Smart lottning upprepade för många möten: ${repeats}`);
    assert.strictEqual(new Set(tables.flat()).size, 12);
    console.log('✅ drawTables smart passes');
  } catch (err) {
    failures++;
    console.error('❌ drawTables smart failed', err);
  }

  // Test: pickPlayers prioritises those with the fewest tables played
  try {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    let t = createTournament('T', ids);
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3', 'p4'] }] });
    const played = playedCounts(t);
    assert.strictEqual(played.get('p1'), 1);
    assert.strictEqual(played.get('p5'), 0);
    const picked = pickPlayers(t, ids, 4, { method: 'smart', rng: seededRng(11) });
    assert.deepStrictEqual([...picked].sort(), ['p5', 'p6', 'p7', 'p8']);
    console.log('✅ pickPlayers smart passes');
  } catch (err) {
    failures++;
    console.error('❌ pickPlayers smart failed', err);
  }

  // Test: round validation
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3', 'p4']);
    assert.throws(() => addTournamentRound(t, { tables: [] }), /minst ett bord/);
    assert.throws(() => addTournamentRound(t, { tables: [{ playerIds: ['p1'] }] }), /2–8/);
    assert.throws(() => addTournamentRound(t, { tables: [{ playerIds: ['p1', 'px'] }] }), /inte med i turneringen/);
    assert.throws(() => addTournamentRound(t, {
      tables: [{ playerIds: ['p1', 'p2'] }, { playerIds: ['p2', 'p3'] }]
    }), /ett bord per omgång/);
    // En slutomgång får ha flera bord — alla deltagare är med.
    const withFinal = addTournamentRound(t, {
      isFinal: true,
      tables: [{ playerIds: ['p1', 'p2'] }, { playerIds: ['p3', 'p4'] }]
    });
    assert.strictEqual(withFinal.rounds[0].tables.length, 2);
    console.log('✅ addTournamentRound validation passes');
  } catch (err) {
    failures++;
    console.error('❌ addTournamentRound validation failed', err);
  }

  // Test: removeTournamentRound renumbers the remaining rounds
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3', 'p4']);
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3', 'p4'] }] });
    t = addTournamentRound(t, { tables: [{ gameId: 'g2', playerIds: ['p1', 'p2', 'p3', 'p4'] }] });
    t = addTournamentRound(t, { tables: [{ gameId: 'g3', playerIds: ['p1', 'p2', 'p3', 'p4'] }] });
    assert.deepStrictEqual(tournamentGameIds(t), ['g1', 'g2', 'g3']);
    t = removeTournamentRound(t, 2);
    assert.deepStrictEqual(t.rounds.map(r => r.number), [1, 2]);
    assert.deepStrictEqual(tournamentGameIds(t), ['g1', 'g3']);
    console.log('✅ removeTournamentRound passes');
  } catch (err) {
    failures++;
    console.error('❌ removeTournamentRound failed', err);
  }

  // Test: standings sum the Kille scores across every table
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3', 'p4']);
    // Bord 1: p1 vinner potten 10 + 60 = 70 från p2 (2:an) och p3 (12:an).
    const g1 = { ...playedGame(['p1', 'p2', 'p3'], 'p1', ['num_2', 'num_12']), id: 'g1' };
    // Bord 2 (nästa omgång): p2 vinner 60 + 10 = 70 från p1 (12:an) och p4 (2:an).
    const g2 = { ...playedGame(['p1', 'p2', 'p4'], 'p2', ['num_12', 'num_2']), id: 'g2' };
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3'] }] });
    t = addTournamentRound(t, { tables: [{ gameId: 'g2', playerIds: ['p1', 'p2', 'p4'] }] });

    const standings = computeStandings(t, [g1, g2]);
    const byId = Object.fromEntries(standings.map(r => [r.playerId, r]));
    assert.strictEqual(byId.p1.points, 70 - 60);
    assert.strictEqual(byId.p2.points, -10 + 70);
    assert.strictEqual(byId.p3.points, -60);
    assert.strictEqual(byId.p4.points, -10);
    assert.strictEqual(byId.p1.tables, 2);
    assert.strictEqual(byId.p1.tableWins, 1);
    assert.strictEqual(byId.p2.tableWins, 1);
    assert.strictEqual(byId.p3.tables, 1);
    assert.strictEqual(byId.p1.roundWins, 1);
    // Sorterad med bäst först: p2 (+60), p1 (+10), p4 (−10), p3 (−60).
    assert.deepStrictEqual(standings.map(r => r.playerId), ['p2', 'p1', 'p4', 'p3']);
    assert.deepStrictEqual(standings.map(r => r.rank), [1, 2, 3, 4]);
    console.log('✅ computeStandings passes');
  } catch (err) {
    failures++;
    console.error('❌ computeStandings failed', err);
  }

  // Test: an unplayed table does not affect the standings
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3', 'p4']);
    const empty = { ...createGame(['p1', 'p2', 'p3', 'p4']), id: 'g1' };
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3', 'p4'] }] });
    const standings = computeStandings(t, [empty]);
    assert.ok(standings.every(r => r.points === 0 && r.tables === 0 && r.best === null));
    console.log('✅ computeStandings ignores unplayed tables');
  } catch (err) {
    failures++;
    console.error('❌ computeStandings unplayed tables failed', err);
  }

  // Test: qualifiers picks the top N from the table
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3', 'p4']);
    const g1 = { ...playedGame(['p1', 'p2', 'p3'], 'p1', ['num_2', 'num_12']), id: 'g1' };
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3'] }] });
    const standings = computeStandings(t, [g1]);
    assert.deepStrictEqual(qualifiers(standings, 2), ['p1', 'p4']);
    console.log('✅ qualifiers passes');
  } catch (err) {
    failures++;
    console.error('❌ qualifiers failed', err);
  }

  // Test: rankedTables seeds every participant by table position
  try {
    const standings = Array.from({ length: 15 }, (_, i) => ({ playerId: `p${i + 1}`, rank: i + 1 }));
    const tables = rankedTables(standings, 5);
    assert.deepStrictEqual(tables[0], ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.strictEqual(tables.flat().length, 15);
    assert.strictEqual(new Set(tables.flat()).size, 15);
    assert.ok(tables.every(t => t.length >= MIN_TABLE_SIZE && t.length <= MAX_TABLE_SIZE));
    // Borden följer tabellordningen: bord 2 tar nästa grupp.
    assert.strictEqual(tables[1][0], 'p6');

    // En ensam kvarvarande spelare sätter sig vid finalbordet i stället för att
    // bli ett bord för sig.
    const nine = Array.from({ length: 9 }, (_, i) => ({ playerId: `q${i + 1}`, rank: i + 1 }));
    const odd = rankedTables(nine, 5);
    assert.strictEqual(odd.length, 2);
    assert.deepStrictEqual(odd.map(t => t.length), [5, 4]);

    // Ett fullsatt finalbord med en ensam spelare kvar delar med sig neråt.
    const nineFull = rankedTables(nine, 8);
    assert.deepStrictEqual(nineFull.map(t => t.length), [7, 2]);

    // Färre deltagare än finalbordet rymmer blir ett enda bord.
    assert.deepStrictEqual(rankedTables(nine.slice(0, 4), 6), [['q1', 'q2', 'q3', 'q4']]);
    console.log('✅ rankedTables passes');
  } catch (err) {
    failures++;
    console.error('❌ rankedTables failed', err);
  }

  // Test: without a final the table decides
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3']);
    const g1 = { ...playedGame(['p1', 'p2', 'p3'], 'p1', ['num_2', 'num_12']), id: 'g1' };
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3'] }] });
    const result = tournamentResult(t, [g1]);
    assert.strictEqual(result.decidedBy, 'table');
    assert.strictEqual(result.winnerId, 'p1');
    assert.deepStrictEqual(result.ranking.map(r => r.place), [1, 2, 3]);
    console.log('✅ tournamentResult by table passes');
  } catch (err) {
    failures++;
    console.error('❌ tournamentResult by table failed', err);
  }

  // Test: a played final decides, and non-finalists rank below the finalists
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3', 'p4']);
    // Grundomgång: p1 leder tabellen stort.
    const g1 = { ...playedGame(['p1', 'p2', 'p3', 'p4'], 'p1', ['num_12', 'num_12', 'num_12']), id: 'g1' };
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3', 'p4'] }] });
    // Final mellan de två bästa — där vinner p2.
    const g2 = { ...playedGame(['p1', 'p2'], 'p2', ['num_1']), id: 'g2' };
    t = addTournamentRound(t, { isFinal: true, method: 'ranked', tables: [{ gameId: 'g2', playerIds: ['p1', 'p2'] }] });

    assert.ok(getFinalRound(t));
    const result = tournamentResult(t, [g1, g2]);
    assert.strictEqual(result.decidedBy, 'final');
    assert.strictEqual(result.winnerId, 'p2');
    assert.deepStrictEqual(result.ranking.slice(0, 2).map(r => r.playerId), ['p2', 'p1']);
    assert.deepStrictEqual(result.ranking.map(r => r.place), [1, 2, 3, 4]);
    console.log('✅ tournamentResult by final passes');
  } catch (err) {
    failures++;
    console.error('❌ tournamentResult by final failed', err);
  }

  // Test: a ranked last round with several tables ranks table by table
  try {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    let t = createTournament('T', ids);
    // Grundomgång så att tabellen finns.
    const g1 = { ...playedGame(ids.slice(0, 4), 'p1', ['num_1', 'num_1', 'num_1']), id: 'g1' };
    const g2 = { ...playedGame(ids.slice(4), 'p5', ['num_1', 'num_1', 'num_1']), id: 'g2' };
    t = addTournamentRound(t, {
      tables: [
        { gameId: 'g1', playerIds: ids.slice(0, 4) },
        { gameId: 'g2', playerIds: ids.slice(4) }
      ]
    });
    // Slutomgång: finalbordet (p1–p4) och bord 2 (p5–p8).
    const f1 = { ...playedGame(['p1', 'p2', 'p3', 'p4'], 'p3', ['num_1', 'num_2', 'num_3']), id: 'f1' };
    const f2 = { ...playedGame(['p5', 'p6', 'p7', 'p8'], 'p8', ['num_1', 'num_2', 'num_3']), id: 'f2' };
    t = addTournamentRound(t, {
      isFinal: true,
      method: 'ranked',
      tables: [
        { gameId: 'f1', playerIds: ['p1', 'p2', 'p3', 'p4'] },
        { gameId: 'f2', playerIds: ['p5', 'p6', 'p7', 'p8'] }
      ]
    });

    const result = tournamentResult(t, [g1, g2, f1, f2]);
    assert.strictEqual(result.decidedBy, 'final');
    // Finalbordets vinnare vinner turneringen.
    assert.strictEqual(result.winnerId, 'p3');
    // Alla åtta är rankade, och finalbordet ligger före bord 2.
    assert.strictEqual(result.ranking.length, 8);
    assert.deepStrictEqual(result.ranking.slice(0, 4).map(r => r.playerId).sort(),
      ['p1', 'p2', 'p3', 'p4']);
    assert.strictEqual(result.ranking[4].playerId, 'p8');
    assert.deepStrictEqual(result.ranking.map(r => r.place), [1, 2, 3, 4, 5, 6, 7, 8]);
    console.log('✅ tournamentResult by ranked last round passes');
  } catch (err) {
    failures++;
    console.error('❌ tournamentResult by ranked last round failed', err);
  }

  // Test: a lower table played but the deciding table not — the table still decides
  try {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    let t = createTournament('T', ids);
    const g1 = { ...playedGame(ids, 'p1', ['num_12', 'num_12', 'num_12']), id: 'g1' };
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ids }] });
    const f1 = { ...createGame(['p1', 'p2']), id: 'f1' };
    const f2 = { ...playedGame(['p3', 'p4'], 'p4', ['num_1']), id: 'f2' };
    t = addTournamentRound(t, {
      isFinal: true,
      method: 'ranked',
      tables: [
        { gameId: 'f1', playerIds: ['p1', 'p2'] },
        { gameId: 'f2', playerIds: ['p3', 'p4'] }
      ]
    });
    const result = tournamentResult(t, [g1, f1, f2]);
    assert.strictEqual(result.decidedBy, 'table');
    assert.strictEqual(result.winnerId, 'p1');
    console.log('✅ tournamentResult waits for the deciding table');
  } catch (err) {
    failures++;
    console.error('❌ tournamentResult deciding table failed', err);
  }

  // Test: an unplayed final falls back to the table
  try {
    let t = createTournament('T', ['p1', 'p2', 'p3']);
    const g1 = { ...playedGame(['p1', 'p2', 'p3'], 'p1', ['num_2', 'num_12']), id: 'g1' };
    const g2 = { ...createGame(['p1', 'p2']), id: 'g2' };
    t = addTournamentRound(t, { tables: [{ gameId: 'g1', playerIds: ['p1', 'p2', 'p3'] }] });
    t = addTournamentRound(t, { isFinal: true, tables: [{ gameId: 'g2', playerIds: ['p1', 'p2'] }] });
    const result = tournamentResult(t, [g1, g2]);
    assert.strictEqual(result.decidedBy, 'table');
    assert.strictEqual(result.winnerId, 'p1');
    console.log('✅ tournamentResult unplayed final falls back to table');
  } catch (err) {
    failures++;
    console.error('❌ tournamentResult unplayed final failed', err);
  }

  // Test: completeTournament
  try {
    const t = completeTournament(createTournament('T', ['p1', 'p2']));
    assert.strictEqual(t.status, 'completed');
    assert.ok(t.completedAt);
    console.log('✅ completeTournament passes');
  } catch (err) {
    failures++;
    console.error('❌ completeTournament failed', err);
  }

  if (failures > 0) {
    console.error(`${failures} test group(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('All tests completed.');
}

runTests();
