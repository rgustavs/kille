/**
 * Kille Import/Export
 * Handles serialisation of all player and game data to/from JSON files.
 */
import { PlayerStore, GameStore } from './store.js';

const FORMAT_VERSION = '1.0';

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Serialise all players and games to a JSON string.
 * @returns {string} Pretty-printed JSON
 */
export function exportData() {
  const payload = {
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    players: PlayerStore.getAll(),
    games: GameStore.getAll()
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Trigger a browser file download of the current data.
 */
export function downloadExport() {
  const json = exportData();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kille-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Parse and import a JSON string, merging with existing local data.
 *
 * Player matching: by name (case-insensitive). Known players are reused;
 * unknown players are created. All player IDs in the incoming games are
 * remapped to the local IDs before saving.
 *
 * Game deduplication: games whose ID already exists locally are skipped.
 *
 * @param {string} jsonString
 * @returns {{ playersAdded: number, gamesAdded: number }}
 * @throws {Error} if the file is not a valid Kille export
 */
export function importData(jsonString) {
  let payload;
  try {
    payload = JSON.parse(jsonString);
  } catch {
    throw new Error('Filen är inte giltig JSON');
  }

  if (!payload.version || !Array.isArray(payload.players) || !Array.isArray(payload.games)) {
    throw new Error('Ogiltig filformat — saknar version, spelare eller spel');
  }

  const existingPlayers = PlayerStore.getAll();
  const existingGameIds = new Set(GameStore.getAll().map(g => g.id));

  // Build importedId → localId map, creating players as needed
  const idMap = {};
  let playersAdded = 0;

  for (const imported of payload.players) {
    const match = existingPlayers.find(
      p => p.name.toLowerCase() === imported.name.toLowerCase()
    );
    if (match) {
      idMap[imported.id] = match.id;
    } else {
      const created = PlayerStore.add(imported.name);
      idMap[imported.id] = created.id;
      playersAdded++;
    }
  }

  // Import games, skipping duplicates
  let gamesAdded = 0;
  for (const game of payload.games) {
    if (existingGameIds.has(game.id)) continue;
    GameStore.save(remapGameIds(game, idMap));
    gamesAdded++;
  }

  return { playersAdded, gamesAdded };
}

/**
 * Read a File object and import its contents.
 * @param {File} file
 * @returns {Promise<{ playersAdded: number, gamesAdded: number }>}
 */
export function importFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        resolve(importData(e.target.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Kunde inte läsa filen'));
    reader.readAsText(file);
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function remapGameIds(game, idMap) {
  const map = id => idMap[id] ?? id;
  return {
    ...game,
    playerIds: game.playerIds.map(map),
    rounds: game.rounds.map(round => ({
      ...round,
      winnerId: map(round.winnerId),
      standByIds: round.standByIds.map(map),
      losers: round.losers.map(l => ({ ...l, playerId: map(l.playerId) }))
    }))
  };
}
