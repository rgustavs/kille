import assert from 'assert';

// ─── Minimal browser-globals så att klientmodulerna kan importeras i Node ─────
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new MemoryStorage();

// Styrbar fetch-mock för att fånga RPC-anrop.
let fetchMode = 'ok';           // 'ok' | 'fail'
const fetchCalls = [];
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: JSON.parse(opts.body) });
  if (fetchMode === 'fail') throw new Error('network down');
  return { ok: true, status: 200, text: async () => 'null' };
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const ACTIVITY_KEY = 'kille_g_G1_activity';
const logCalls = () => fetchCalls.filter(c => c.url.endsWith('/kille_log_activity'));

async function runTests() {
  console.log('Running activity/analytics tests...');
  let failures = 0;

  const { Session } = await import('../js/session.js');
  const { Activity } = await import('../js/analytics.js');

  const snapshot = {
    group: { id: 'G1', name: 'Testgruppen', slug: 'testgruppen', joinCode: 'ABC234' },
    role: 'admin',
    members: [{ id: 'm1', name: 'Rasmus', role: 'admin' }],
    players: [],
    games: []
  };

  // Test: under tröskeln köas händelser lokalt utan att skickas.
  try {
    Session.setGroup(snapshot, 'Rasmus', true);
    localStorage.removeItem(ACTIVITY_KEY);
    fetchCalls.length = 0;
    fetchMode = 'ok';
    Activity.track('screen_view', { screen: 'home' });
    Activity.track('screen_view', { screen: 'stats' });
    Activity.track('feature_used', { feature: 'export' });
    await wait(10);
    assert.strictEqual(Activity.pending(), 3, 'tre händelser ska köas');
    assert.strictEqual(logCalls().length, 0, 'inget ska skickas under tröskeln');
    console.log('✅ activity queues below threshold passes');
  } catch (err) { failures++; console.error('❌ activity queues below threshold failed', err); }

  // Test: manuell flush skickar batchen med rätt payload och tömmer kön.
  try {
    fetchCalls.length = 0;
    await Activity.flush();
    await wait(10);
    const call = logCalls()[0];
    assert.ok(call, 'kille_log_activity ska ha anropats');
    assert.strictEqual(call.body.p_group_id, 'G1');
    assert.strictEqual(call.body.p_member_id, 'm1');
    assert.strictEqual(call.body.p_member_name, 'Rasmus');
    assert.ok(Array.isArray(call.body.p_events), 'p_events ska vara en array');
    assert.strictEqual(call.body.p_events.length, 3);
    assert.strictEqual(call.body.p_events[0].type, 'screen_view');
    assert.ok(call.body.p_events[0].at, 'varje händelse ska ha en tidsstämpel');
    assert.strictEqual(Activity.pending(), 0, 'kön ska tömmas efter flush');
    console.log('✅ activity flush payload passes');
  } catch (err) { failures++; console.error('❌ activity flush payload failed', err); }

  // Test: tröskeln (10) utlöser automatisk flush.
  try {
    localStorage.removeItem(ACTIVITY_KEY);
    fetchCalls.length = 0;
    for (let i = 0; i < 10; i++) Activity.track('screen_view', { screen: `s${i}` });
    await wait(20);
    assert.strictEqual(logCalls().length, 1, 'tröskeln ska utlösa exakt en flush');
    assert.strictEqual(logCalls()[0].body.p_events.length, 10);
    assert.strictEqual(Activity.pending(), 0);
    console.log('✅ activity auto-flush at threshold passes');
  } catch (err) { failures++; console.error('❌ activity auto-flush at threshold failed', err); }

  // Test: offline behåller händelser, som skickas när nätet är tillbaka.
  try {
    localStorage.removeItem(ACTIVITY_KEY);
    fetchMode = 'fail';
    fetchCalls.length = 0;
    for (let i = 0; i < 10; i++) Activity.track('feature_used', { feature: `f${i}` });
    await wait(20);
    assert.strictEqual(Activity.pending(), 10, 'händelser ska ligga kvar offline');
    fetchMode = 'ok';
    fetchCalls.length = 0;   // isolera återförsöket när nätet är tillbaka
    await Activity.flush();
    await wait(10);
    assert.strictEqual(Activity.pending(), 0, 'kön ska tömmas när nätet är tillbaka');
    assert.strictEqual(logCalls().length, 1, 'exakt ett lyckat återförsök');
    assert.strictEqual(logCalls()[0].body.p_events.length, 10);
    console.log('✅ activity offline retention passes');
  } catch (err) { failures++; console.error('❌ activity offline retention failed', err); }

  // Test: i lokalt läge loggas ingenting (integritet — allt stannar på enheten).
  try {
    Session.setLocal();
    fetchCalls.length = 0;
    Activity.track('screen_view', { screen: 'home' });
    await Activity.flush();
    await wait(10);
    assert.strictEqual(Activity.pending(), 0, 'lokalt läge ska inte köa något');
    assert.strictEqual(logCalls().length, 0, 'lokalt läge ska inte skicka något');
    console.log('✅ activity local-mode no-op passes');
  } catch (err) { failures++; console.error('❌ activity local-mode no-op failed', err); }

  if (failures > 0) {
    console.error(`${failures} test group(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All tests completed.');
}

runTests();
