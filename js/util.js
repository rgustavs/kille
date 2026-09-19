/**
 * Kille — shared utilities with no DOM or storage dependencies.
 */

/** Generate a short, reasonably unique ID. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Normaliserad namnnyckel: samma namn ska hittas oavsett skiftläge,
 * mellanslag och svenska tecken. Speglar `_kille_name_key` i databasen så att
 * klient och server grupperar användare likadant.
 * @param {string} name
 * @returns {string} t.ex. "Robert Öström" → "robertostrom"
 */
export function nameKey(name) {
  const from = 'åäàáâãöøòóôõüùúûñçéèêëíìîïý';
  const to   = 'aaaaaaoooooouuuunceeeeiiiiy';
  return String(name || '').trim().toLowerCase()
    .split('')
    .map(ch => { const i = from.indexOf(ch); return i === -1 ? ch : to[i]; })
    .join('')
    .replace(/[^a-z0-9]+/g, '');
}
