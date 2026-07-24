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
let fetchMode = 'ok';           // 'ok' | 'fail' | 'rpcError'
const fetchCalls = [];
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: JSON.parse(opts.body) });
  if (fetchMode === 'fail') throw new Error('network down');
  if (fetchMode === 'rpcError') {
    return { ok: false, status: 400, text: async () => JSON.stringify({ message: 'INVALID_GROUP_OR_CODE' }) };
  }
  return { ok: true, status: 200, text: async () => 'null' };
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
  console.log('Running groups/session/store tests...');
  let failures = 0;

  const { Session } = await import('../js/session.js');
  const { PlayerStore, GameStore, GroupData } = await import('../js/store.js');
  const { Outbox, Groups, SuperAdmin } = await import('../js/remote.js');
  const { rpc, RpcError } = await import('../js/supabase.js');
  const { slugify } = await import('../js/router.js');

  const snapshot = {
    group: { id: 'G1', name: 'Testgruppen', slug: 'testgruppen', joinCode: 'ABC234' },
    role: 'admin',
    members: [{ id: 'm1', name: 'Rasmus', role: 'admin' }],
    players: [],
    games: []
  };

  // Test: lokalt läge lagrar under de klassiska nycklarna.
  try {
    Session.setLocal();
    PlayerStore.invalidate();
    const p = PlayerStore.add('LokalSpelare');
    assert.ok(localStorage.getItem('kille_players'), 'kille_players ska finnas');
    assert.ok(localStorage.getItem('kille_players').includes(p.id));
    console.log('✅ local mode storage passes');
  } catch (err) { failures++; console.error('❌ local mode storage failed', err); }

  // Test: grupp-läge namespacar data separat från lokalt.
  try {
    Session.setGroup(snapshot, 'Rasmus', true);
    GroupData.hydrate(snapshot);
    assert.strictEqual(Session.isGroup(), true);
    assert.strictEqual(Session.isAdmin(), true);
    assert.strictEqual(Session.memberId, 'm1');
    // Gruppens roster är tom trots att lokalt läge har en spelare.
    assert.strictEqual(PlayerStore.getAll().length, 0);
    console.log('✅ group namespacing passes');
  } catch (err) { failures++; console.error('❌ group namespacing failed', err); }

  // Test: ändringar i grupp-läge köas och synkas via RPC.
  try {
    fetchMode = 'ok';
    fetchCalls.length = 0;
    const gp = PlayerStore.add('GruppSpelare');
    assert.ok(localStorage.getItem('kille_g_G1_players').includes(gp.id));
    await wait(30);
    assert.strictEqual(Outbox.pending(), 0, 'outbox ska tömmas när online');
    const call = fetchCalls.find(c => c.url.endsWith('/kille_save_player'));
    assert.ok(call, 'kille_save_player ska ha anropats');
    assert.strictEqual(call.body.p_group_id, 'G1');
    assert.strictEqual(call.body.p_name, 'GruppSpelare');
    // Aktivitet: upphovspersonen ska följa med (fångad vid enqueue).
    assert.strictEqual(call.body.p_member_id, 'm1', 'save_player ska bära actor-id');
    assert.strictEqual(call.body.p_member_name, 'Rasmus', 'save_player ska bära actor-namn');
    console.log('✅ group sync enqueue/flush passes');
  } catch (err) { failures++; console.error('❌ group sync enqueue/flush failed', err); }

  // Test: offline behåller ändringar i outboxen, som sedan töms.
  try {
    fetchMode = 'fail';
    fetchCalls.length = 0;
    GameStore.invalidate();
    GameStore.save({ id: 'game1', playerIds: ['m1'], rounds: [], status: 'active' });
    await wait(30);
    assert.ok(Outbox.pending() >= 1, 'outbox ska behålla ändringar offline');
    fetchMode = 'ok';
    await Outbox.flush();
    await wait(30);
    assert.strictEqual(Outbox.pending(), 0, 'outbox ska tömmas när online igen');
    // saveGame ska också bära upphovspersonen genom kön.
    const gameCall = fetchCalls.find(c => c.url.endsWith('/kille_save_game'));
    assert.ok(gameCall, 'kille_save_game ska ha anropats');
    assert.strictEqual(gameCall.body.p_member_id, 'm1', 'save_game ska bära actor-id');
    assert.strictEqual(gameCall.body.p_member_name, 'Rasmus', 'save_game ska bära actor-namn');
    console.log('✅ offline outbox retention passes');
  } catch (err) { failures++; console.error('❌ offline outbox retention failed', err); }

  // Test: byte tillbaka till lokalt läge isolerar gruppdata.
  try {
    Session.setLocal();
    const names = PlayerStore.getAll().map(p => p.name);
    assert.ok(names.includes('LokalSpelare'));
    assert.ok(!names.includes('GruppSpelare'), 'gruppdata ska inte läcka till lokalt');
    console.log('✅ mode isolation passes');
  } catch (err) { failures++; console.error('❌ mode isolation failed', err); }

  // Test: RPC-fel mappas till begripliga meddelanden.
  try {
    fetchMode = 'rpcError';
    let caught = null;
    try { await rpc('kille_join_group', { p_join_code: 'nope' }); }
    catch (e) { caught = e; }
    assert.ok(caught instanceof RpcError);
    assert.strictEqual(caught.code, 'INVALID_GROUP_OR_CODE');
    assert.ok(/gruppkod/i.test(caught.message));
    console.log('✅ rpc error mapping passes');
  } catch (err) { failures++; console.error('❌ rpc error mapping failed', err); }

  // Test: slugify producerar URL-vänliga slugs (inkl. svenska tecken).
  try {
    assert.strictEqual(slugify('Gustavsson and Friends'), 'gustavsson-and-friends');
    assert.strictEqual(slugify('Familjen Öström!'), 'familjen-ostrom');
    assert.strictEqual(slugify('  Åäö  test  '), 'aao-test');
    console.log('✅ slugify passes');
  } catch (err) { failures++; console.error('❌ slugify failed', err); }

  // Test: session sparar slug och grupp-URL kan härledas.
  try {
    Session.setGroup(snapshot, 'Rasmus', true);
    assert.strictEqual(Session.group.slug, 'testgruppen');
    console.log('✅ session stores slug passes');
  } catch (err) { failures++; console.error('❌ session stores slug failed', err); }

  // Test: getBySlug och super-admin-anrop mappar till rätt RPC + parametrar.
  try {
    fetchMode = 'ok';
    fetchCalls.length = 0;
    await Groups.getBySlug('gustavsson-and-friends', 'Richard');
    const bySlug = fetchCalls.find(c => c.url.endsWith('/kille_get_group_by_slug'));
    assert.ok(bySlug, 'kille_get_group_by_slug anropad');
    assert.strictEqual(bySlug.body.p_slug, 'gustavsson-and-friends');

    fetchCalls.length = 0;
    await SuperAdmin.login('admin', 'hemligt');
    assert.ok(fetchCalls.find(c => c.url.endsWith('/kille_sa_login')), 'kille_sa_login anropad');

    const cred = { username: 'admin', password: 'hemligt' };
    fetchCalls.length = 0;
    await SuperAdmin.createGroup(cred, 'Nya Gänget', 'kod1234', 'nya-ganget');
    const create = fetchCalls.find(c => c.url.endsWith('/kille_sa_create_group'));
    assert.ok(create, 'kille_sa_create_group anropad');
    assert.strictEqual(create.body.p_name, 'Nya Gänget');
    assert.strictEqual(create.body.p_slug, 'nya-ganget');
    assert.strictEqual(create.body.p_username, 'admin');

    // pull ska skicka medlems-id som heartbeat för "senast aktiv".
    Session.setGroup(snapshot, 'Rasmus', true);
    fetchCalls.length = 0;
    await Groups.pull();
    const pull = fetchCalls.find(c => c.url.endsWith('/kille_pull'));
    assert.ok(pull, 'kille_pull anropad');
    assert.strictEqual(pull.body.p_member_id, 'm1', 'pull ska bära medlems-id');
    console.log('✅ slug/super-admin RPC mapping passes');
  } catch (err) { failures++; console.error('❌ slug/super-admin RPC mapping failed', err); }

  if (failures > 0) {
    console.error(`${failures} test group(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All tests completed.');
}

runTests();
