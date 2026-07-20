/**
 * Kille — Minimal Supabase-klient.
 *
 * Beroendefri wrapper runt Supabase/PostgREST RPC-endpointen. All åtkomst till
 * den centrala gruppdatabasen sker via SECURITY DEFINER-funktioner (kille_*),
 * så vi behöver bara kunna anropa `rpc(fn, params)`.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/** Fel som är begripliga för användaren mappas till svenska meddelanden. */
const FRIENDLY_ERRORS = {
  INVALID_GROUP_OR_CODE: 'Fel gruppkod — kontrollera koden och försök igen.',
  INVALID_ADMIN_CODE: 'Fel admin-kod.',
  ADMIN_CODE_TOO_SHORT: 'Admin-koden måste vara minst 4 tecken.',
  GROUP_NAME_REQUIRED: 'Gruppen måste ha ett namn.',
  GAME_ID_REQUIRED: 'Spelet saknar id.',
  INVALID_ROLE: 'Ogiltig roll.'
};

export class RpcError extends Error {
  constructor(code, message) {
    super(message || code || 'Okänt fel');
    this.name = 'RpcError';
    this.code = code || null;
  }
}

/**
 * Anropa en RPC-funktion i databasen.
 * @param {string} fn - Funktionsnamn (t.ex. 'kille_join_group')
 * @param {object} params - Namngivna parametrar
 * @returns {Promise<any>} Funktionens returvärde (JSON)
 */
export async function rpc(fn, params = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(params)
    });
  } catch {
    throw new RpcError('NETWORK', 'Ingen anslutning till servern.');
  }

  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    const raw = body && typeof body === 'object' ? (body.message || body.hint || body.details) : String(body || '');
    // PostgREST lägger vårt raise-meddelande i `message`.
    const code = typeof raw === 'string'
      ? Object.keys(FRIENDLY_ERRORS).find(c => raw.includes(c)) || null
      : null;
    const friendly = code ? FRIENDLY_ERRORS[code] : (raw || `Serverfel (${res.status}).`);
    throw new RpcError(code, friendly);
  }

  return body;
}
