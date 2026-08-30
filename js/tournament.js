/**
 * Kille — Turneringslogik.
 *
 * Ren domänlogik utan DOM, lagring eller andra sidoeffekter:
 *  - en turnering samlar ett antal deltagare,
 *  - varje turneringsomgång delar upp deltagarna på ett eller flera bord,
 *  - varje bord spelas som ett vanligt Kille-spel (protokoll) och kopplas till
 *    turneringen via spelets id,
 *  - turneringstabellen är summan av spelarnas slutställningar från alla bord,
 *  - turneringen avgörs antingen av tabellen eller av en avslutande rankad
 *    omgång där alla deltagare spelar: de topprankade vid finalbordet, nästa
 *    grupp vid bord 2 och så vidare. Finalbordets placering avgör turneringen.
 */
import { calculateScoreTable } from './game.js';
import { uid } from './util.js';

/** Minsta respektive största antal spelare vid ett bord i en omgång. */
export const MIN_TABLE_SIZE = 4;
export const MAX_TABLE_SIZE = 7;

/** Ett Kille-spel klarar 2–8 spelare; finalen spelas alltid vid ett bord. */
export const MIN_GAME_SIZE = 2;
export const MAX_GAME_SIZE = 8;

// ─── Skapa & uppdatera ───────────────────────────────────────────────────────

/**
 * Skapa en ny turnering.
 * @param {string} name - Turneringens namn
 * @param {string[]} playerIds - Deltagarnas spelar-id (minst 2)
 * @returns {object} Turneringsobjektet
 */
export function createTournament(name, playerIds) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw new Error('Turneringen behöver ett namn');
  }
  if (!Array.isArray(playerIds) || playerIds.length < MIN_GAME_SIZE) {
    throw new Error('En turnering kräver minst 2 deltagare');
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('Samma deltagare kan bara vara med en gång');
  }
  return {
    id: uid(),
    name: trimmed,
    playerIds: [...playerIds],
    rounds: [],
    status: 'active', // 'active' | 'completed'
    createdAt: new Date().toISOString()
  };
}

/** Lägg till deltagare i en pågående turnering. Returnerar ett nytt objekt. */
export function addParticipants(tournament, playerIds) {
  const existing = new Set(tournament.playerIds);
  const added = playerIds.filter(id => !existing.has(id));
  if (added.length === 0) return tournament;
  return { ...tournament, playerIds: [...tournament.playerIds, ...added] };
}

/**
 * Ta bort en deltagare. Går bara om deltagaren inte spelat någon omgång —
 * annars skulle tabellen och spelprotokollen sluta hänga ihop.
 */
export function removeParticipant(tournament, playerId) {
  const hasPlayed = tournament.rounds.some(r => r.tables.some(t => t.playerIds.includes(playerId)));
  if (hasPlayed) {
    throw new Error('Deltagaren har redan spelat en omgång');
  }
  return { ...tournament, playerIds: tournament.playerIds.filter(id => id !== playerId) };
}

/**
 * Lägg till en omgång.
 * @param {object} tournament
 * @param {object} roundData - { tables: [{ gameId, playerIds }], method, isFinal }
 * @returns {object} Uppdaterad turnering
 */
export function addTournamentRound(tournament, roundData) {
  if (!tournament || !Array.isArray(tournament.rounds)) {
    throw new Error('Ogiltig turnering');
  }
  const { tables = [], method = 'manual', isFinal = false } = roundData || {};
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new Error('Omgången behöver minst ett bord');
  }
  const participants = new Set(tournament.playerIds);
  const seen = new Set();
  const cleanTables = tables.map((table, index) => {
    const ids = Array.isArray(table.playerIds) ? table.playerIds : [];
    if (ids.length < MIN_GAME_SIZE || ids.length > MAX_GAME_SIZE) {
      throw new Error(`Bord ${index + 1} måste ha 2–8 spelare`);
    }
    ids.forEach(id => {
      if (!participants.has(id)) throw new Error('Spelaren är inte med i turneringen');
      if (seen.has(id)) throw new Error('En spelare kan bara sitta vid ett bord per omgång');
      seen.add(id);
    });
    return { gameId: table.gameId || null, playerIds: [...ids] };
  });

  const round = {
    number: tournament.rounds.length + 1,
    method,
    isFinal: isFinal === true,
    tables: cleanTables,
    createdAt: new Date().toISOString()
  };
  return { ...tournament, rounds: [...tournament.rounds, round] };
}

/** Ta bort en omgång och numrera om de följande. Returnerar en ny turnering. */
export function removeTournamentRound(tournament, roundNumber) {
  const rounds = tournament.rounds
    .filter(r => r.number !== roundNumber)
    .map((r, i) => ({ ...r, number: i + 1 }));
  return { ...tournament, rounds };
}

/** Avsluta turneringen. */
export function completeTournament(tournament) {
  return { ...tournament, status: 'completed', completedAt: new Date().toISOString() };
}

/** Återöppna en avslutad turnering. */
export function reopenTournament(tournament) {
  const { completedAt, ...rest } = tournament;
  return { ...rest, status: 'active' };
}

/** Alla spel-id som hör till turneringen. */
export function tournamentGameIds(tournament) {
  return tournament.rounds.flatMap(r => r.tables.map(t => t.gameId).filter(Boolean));
}

/** Den avgörande finalomgången, om turneringen har en. */
export function getFinalRound(tournament) {
  return tournament.rounds.find(r => r.isFinal) || null;
}

// ─── Lottning ────────────────────────────────────────────────────────────────

/** Fisher–Yates — returnerar en ny, blandad lista. */
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Hur många bord ett antal spelare bör delas upp på, givet önskad bordsstorlek.
 * Väljer minsta antal bord som får plats inom [min, max] spelare per bord.
 */
export function tableCountFor(playerCount, min = MIN_TABLE_SIZE, max = MAX_TABLE_SIZE) {
  const n = Number(playerCount) || 0;
  if (n < MIN_GAME_SIZE) {
    throw new Error('Minst 2 spelare krävs');
  }
  if (n <= max) return 1;
  const lowest = Math.ceil(n / max);
  const highest = Math.floor(n / min);
  for (let t = lowest; t <= highest; t++) return t;
  // Går inte att fylla alla bord till minimistorleken — ta minsta möjliga antal.
  return lowest;
}

/** Jämnt fördelade bordsstorlekar (de största borden först). */
export function tableSizes(playerCount, tableCount) {
  const t = Math.max(1, tableCount);
  const base = Math.floor(playerCount / t);
  const rem = playerCount % t;
  return Array.from({ length: t }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Största och minsta antal bord som är möjliga för ett antal spelare. */
export function tableCountRange(playerCount) {
  const n = Number(playerCount) || 0;
  const max = Math.max(1, Math.floor(n / MIN_GAME_SIZE));
  const min = Math.max(1, Math.ceil(n / MAX_GAME_SIZE));
  return { min, max: Math.max(min, max) };
}

function chunk(list, sizes) {
  const out = [];
  let i = 0;
  sizes.forEach(size => {
    out.push(list.slice(i, i + size));
    i += size;
  });
  return out;
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Hur många gånger varje par av deltagare redan har suttit vid samma bord.
 * @returns {Map<string, number>}
 */
export function meetingCounts(tournament) {
  const counts = new Map();
  tournament.rounds.forEach(round => {
    round.tables.forEach(table => {
      const ids = table.playerIds;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j]);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    });
  });
  return counts;
}

/** Hur många bord varje deltagare har spelat. */
export function playedCounts(tournament) {
  const counts = new Map(tournament.playerIds.map(id => [id, 0]));
  tournament.rounds.forEach(round => {
    round.tables.forEach(table => {
      table.playerIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    });
  });
  return counts;
}

/** Kostnaden för en bordsuppdelning: upprepade möten straffas kvadratiskt. */
function assignmentCost(tables, counts) {
  let cost = 0;
  tables.forEach(ids => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const met = counts.get(pairKey(ids[i], ids[j])) || 0;
        cost += met * met;
      }
    }
  });
  return cost;
}

/**
 * Smart lottning: börja från en slumpad uppdelning och byt spelare mellan bord
 * så länge det minskar antalet upprepade möten.
 */
function smartAssign(tournament, playerIds, sizes, rng) {
  const counts = meetingCounts(tournament);
  let best = chunk(shuffle(playerIds, rng), sizes);
  let bestCost = assignmentCost(best, counts);
  if (best.length < 2 || bestCost === 0) return best;

  let improved = true;
  let passes = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;
    for (let a = 0; a < best.length; a++) {
      for (let b = a + 1; b < best.length; b++) {
        for (let i = 0; i < best[a].length; i++) {
          for (let j = 0; j < best[b].length; j++) {
            const candidate = best.map(t => [...t]);
            [candidate[a][i], candidate[b][j]] = [candidate[b][j], candidate[a][i]];
            const cost = assignmentCost(candidate, counts);
            if (cost < bestCost) {
              best = candidate;
              bestCost = cost;
              improved = true;
            }
          }
        }
      }
    }
  }
  return best;
}

/** Dela upp spelare på bord i den ordning de kommer, utan att lotta om. */
export function splitInOrder(playerIds, tableCount) {
  return chunk(playerIds, tableSizes(playerIds.length, tableCount));
}

/**
 * Dela upp spelare på bord.
 * @param {object} tournament
 * @param {string[]} playerIds - Spelarna som ska delas upp
 * @param {object} options - { method: 'random'|'smart', tableCount, rng }
 * @returns {string[][]} En lista med bord, vart och ett en lista med spelar-id
 */
export function drawTables(tournament, playerIds, options = {}) {
  const { method = 'random', tableCount, rng = Math.random } = options;
  const ids = [...playerIds];
  if (ids.length < MIN_GAME_SIZE) {
    throw new Error('Minst 2 spelare krävs för en omgång');
  }
  const count = tableCount || tableCountFor(ids.length);
  const sizes = tableSizes(ids.length, count);
  if (method === 'smart') {
    return smartAssign(tournament, ids, sizes, rng);
  }
  return chunk(shuffle(ids, rng), sizes);
}

/**
 * Välj ut vilka deltagare som ska spela när färre än alla får plats.
 * 'smart' prioriterar dem som spelat minst antal omgångar.
 */
export function pickPlayers(tournament, candidates, count, options = {}) {
  const { method = 'random', rng = Math.random } = options;
  const ids = shuffle(candidates, rng);
  if (method === 'smart') {
    const played = playedCounts(tournament);
    ids.sort((a, b) => (played.get(a) || 0) - (played.get(b) || 0));
  }
  return ids.slice(0, Math.min(count, ids.length));
}

// ─── Tabell & resultat ───────────────────────────────────────────────────────

/**
 * Turneringstabellen — summan av spelarnas slutställning från varje bord.
 * @param {object} tournament
 * @param {object[]} games - Alla spel (turneringens spel plockas ut via id)
 * @returns {object[]} Rader sorterade med bäst först
 */
export function computeStandings(tournament, games) {
  const gameById = new Map((games || []).map(g => [g.id, g]));
  const order = new Map(tournament.playerIds.map((id, i) => [id, i]));
  const rows = new Map(tournament.playerIds.map(id => [id, {
    playerId: id,
    points: 0,
    tables: 0,
    tableWins: 0,
    rounds: 0,
    roundWins: 0,
    best: null
  }]));

  tournament.rounds.forEach(round => {
    round.tables.forEach(table => {
      const game = table.gameId ? gameById.get(table.gameId) : null;
      if (!game) return;
      const { rounds, totals } = calculateScoreTable(game);
      if (rounds.length === 0) return;
      const best = Math.max(...table.playerIds.map(id => totals[id] || 0));
      table.playerIds.forEach(id => {
        const row = rows.get(id);
        if (!row) return;
        const total = totals[id] || 0;
        row.points += total;
        row.tables += 1;
        if (total === best) row.tableWins += 1;
        row.best = row.best === null ? total : Math.max(row.best, total);
        rounds.forEach(r => {
          const s = r.scores[id];
          if (!s || s.isStandBy) return;
          row.rounds += 1;
          if (s.isWinner) row.roundWins += 1;
        });
      });
    });
  });

  return [...rows.values()].sort((a, b) =>
    b.points - a.points ||
    b.tableWins - a.tableWins ||
    b.roundWins - a.roundWins ||
    (order.get(a.playerId) - order.get(b.playerId))
  ).map((row, i) => ({ ...row, rank: i + 1 }));
}

/** De topp-N rankade deltagarna i tabellen — underlaget för en final. */
export function qualifiers(standings, count) {
  return standings.slice(0, Math.max(0, count)).map(row => row.playerId);
}

/**
 * Borden i en rankad slutomgång. Alla deltagare är med: de topprankade möts vid
 * finalbordet (bord 1), nästa grupp vid bord 2 och så vidare, så att bordet man
 * hamnar vid speglar tabellplaceringen.
 * @param {object[]} standings - Tabellen, bäst först (se computeStandings)
 * @param {number} topCount - Antal spelare vid finalbordet
 * @returns {string[][]} Borden i rankad ordning
 */
export function rankedTables(standings, topCount, options = {}) {
  const { min = MIN_TABLE_SIZE, max = MAX_TABLE_SIZE } = options;
  if (!Array.isArray(standings) || standings.length < MIN_GAME_SIZE) return [];
  const top = Math.min(
    Math.max(Number(topCount) || max, MIN_GAME_SIZE),
    Math.min(MAX_GAME_SIZE, standings.length)
  );
  const tables = [qualifiers(standings, top)];
  const rest = standings.slice(top).map(row => row.playerId);

  if (rest.length >= MIN_GAME_SIZE) {
    tables.push(...chunk(rest, tableSizes(rest.length, tableCountFor(rest.length, min, max))));
  } else if (rest.length === 1) {
    // En ensam spelare kan inte utgöra ett bord: låt hen sitta med vid
    // finalbordet, eller — om det redan är fullt — bilda ett bord med den sist
    // rankade därifrån.
    if (tables[0].length < MAX_GAME_SIZE) tables[0].push(rest[0]);
    else tables.push([tables[0].pop(), rest[0]]);
  }
  return tables;
}

/**
 * Turneringens slutresultat.
 * Har turneringen en finalomgång avgör placeringen i finalen; annars tabellen.
 * @returns {object} { decidedBy, winnerId, ranking: [{ playerId, place, ... }] }
 */
export function tournamentResult(tournament, games) {
  const standings = computeStandings(tournament, games);
  const byId = new Map(standings.map(row => [row.playerId, row]));
  const scoreTableFor = table => {
    const game = table.gameId ? (games || []).find(g => g.id === table.gameId) : null;
    const played = game ? calculateScoreTable(game) : null;
    return played && played.rounds.length > 0 ? played : null;
  };

  const final = getFinalRound(tournament);
  // Finalbordet avgör turneringen — är det inte spelat står tabellen kvar.
  const decided = final ? scoreTableFor(final.tables[0]) : null;

  if (decided) {
    const seated = new Set();
    const ranked = [];
    final.tables.forEach(table => {
      const played = scoreTableFor(table);
      const rows = table.playerIds.map(id => {
        const row = byId.get(id) || { playerId: id, points: 0 };
        return played ? { ...row, finalScore: played.totals[id] || 0 } : { ...row };
      });
      // Spelade bord ordnas av sitt resultat; ospelade behåller sin seedning.
      if (played) rows.sort((a, b) => b.finalScore - a.finalScore || b.points - a.points);
      rows.forEach(row => { seated.add(row.playerId); ranked.push(row); });
    });
    const rest = standings.filter(row => !seated.has(row.playerId));
    const ranking = [...ranked, ...rest].map((row, i) => ({ ...row, place: i + 1 }));
    return { decidedBy: 'final', winnerId: ranking[0]?.playerId || null, ranking, standings };
  }

  const ranking = standings.map((row, i) => ({ ...row, place: i + 1 }));
  return { decidedBy: 'table', winnerId: ranking[0]?.playerId || null, ranking, standings };
}
