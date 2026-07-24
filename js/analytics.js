/**
 * Kille — Produktanalys (användningshändelser).
 *
 * `Activity.track(type, detail)` samlar lättviktiga användningshändelser
 * (skärmvisningar, funktionsanvändning, PWA-installation) i en lokal kö och
 * skickar dem i batch till den centrala databasen via `kille_log_activity`.
 *
 * Designen speglar `Outbox` i remote.js: kön ligger i localStorage så att läget
 * är offline-tåligt — händelser som inte kunde skickas ligger kvar och skickas
 * vid nästa tillfälle (tröskel, `online`-event eller när fliken göms).
 *
 * Endast grupp-läge loggar. I lokalt läge stannar allt på enheten (integritet),
 * så `track` är då en no-op.
 */
import { rpc } from './supabase.js';
import { Session } from './session.js';

const FLUSH_THRESHOLD = 10;   // skicka automatiskt när så här många köats
const MAX_BATCH = 100;        // max antal händelser per skickning
const MAX_QUEUE = 500;        // ta bort äldsta om kön växer förbi detta (offline)

let flushing = false;

function queueKey() {
  const g = Session.group;
  return g ? `kille_g_${g.id}_activity` : null;
}

function readQueue() {
  const key = queueKey();
  if (!key || typeof localStorage === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeQueue(events) {
  const key = queueKey();
  if (!key || typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(events));
}

export const Activity = {
  /** Antal ännu ej skickade händelser. */
  pending() {
    return readQueue().length;
  },

  /**
   * Registrera en användningshändelse. No-op i lokalt läge.
   * @param {string} type - t.ex. 'screen_view', 'feature_used', 'pwa_install'
   * @param {object} [detail] - valfri metadata (t.ex. { screen: 'stats' })
   */
  track(type, detail) {
    if (!Session.isGroup() || !type) return;
    const q = readQueue();
    q.push({ type, detail: detail || null, at: new Date().toISOString() });
    if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
    writeQueue(q);
    if (q.length >= FLUSH_THRESHOLD) this.flush();
  },

  /** Skicka köade händelser i batch. Bäst-möjligt: behåll vid fel. */
  async flush() {
    if (flushing || !Session.isGroup()) return;
    const g = Session.group;
    const batch = readQueue().slice(0, MAX_BATCH);
    if (batch.length === 0) return;
    flushing = true;
    try {
      await rpc('kille_log_activity', {
        p_group_id: g.id,
        p_join_code: g.joinCode,
        p_member_id: Session.memberId,
        p_member_name: Session.memberName,
        p_events: batch
      });
      // Kön kan ha vuxit under skickningen — ta bara bort de vi faktiskt skickade.
      writeQueue(readQueue().slice(batch.length));
    } catch {
      // Nätverksfel: låt köade händelser ligga kvar och skicka nästa gång.
    } finally {
      flushing = false;
    }
  }
};

// Skicka vid återanslutning och när fliken göms (t.ex. användaren byter app).
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => Activity.flush());
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') Activity.flush();
  });
}
