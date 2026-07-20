/**
 * Kille — enkel URL-routing för grupper och super-admin.
 *
 * Varje grupp har en egen delbar URL via sin slug, antingen som sökväg
 * (`/g/gustavsson-and-friends`, kräver en rewrite på hosten — se vercel.json)
 * eller som query-parameter (`/?g=gustavsson-and-friends`, fungerar överallt).
 * Super-admin-konsolen nås via `/?admin=1` eller `/admin`.
 */

/** Slug från URL:en, eller null. Läser både /g/<slug> och ?g=<slug>. */
export function groupSlugFromUrl() {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('g');
  if (q) return slugify(q);
  const m = location.pathname.match(/\/g\/([^/?#]+)/);
  return m ? slugify(decodeURIComponent(m[1])) : null;
}

/** True om URL:en pekar på super-admin-konsolen. */
export function isAdminUrl() {
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('admin');
  if (q === '1' || q === 'true') return true;
  return /\/admin\/?$/.test(location.pathname);
}

/** Bygg en delbar grupp-URL (query-formen fungerar på alla statiska hostar). */
export function groupUrl(slug) {
  if (typeof location === 'undefined' || !slug) return '';
  return `${location.origin}/?g=${encodeURIComponent(slug)}`;
}

/** Uppdatera adressfältet till gruppens URL utan att ladda om sidan. */
export function setUrlForGroup(slug) {
  if (typeof history === 'undefined' || !slug) return;
  try {
    history.replaceState({}, '', `/?g=${encodeURIComponent(slug)}`);
  } catch { /* ignoreras (t.ex. file://) */ }
}

/** Rensa grupp-/admin-parametrar ur adressfältet (tillbaka till roten). */
export function clearUrl() {
  if (typeof history === 'undefined') return;
  try {
    history.replaceState({}, '', location.pathname.replace(/\/(g\/[^/]+|admin)\/?$/, '/'));
    const url = new URL(location.href);
    url.searchParams.delete('g');
    url.searchParams.delete('admin');
    history.replaceState({}, '', url.pathname + (url.search || ''));
  } catch { /* ignoreras */ }
}

/** Normalisera en sträng till en slug (samma regler som databasen). */
export function slugify(text) {
  const map = { å: 'a', ä: 'a', ö: 'o', ø: 'o', æ: 'a', é: 'e', è: 'e', ü: 'u', ç: 'c', ñ: 'n' };
  return String(text || '')
    .toLowerCase()
    .replace(/[åäöøæéèüçñ]/g, c => map[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
