/**
 * Kille — kontrollerar att den genererade en-kommandos-versionen av schemat
 * fortfarande motsvarar supabase/schema.sql.
 *
 * supabase/schema-single-statement.sql är incheckad för att kunna kopieras rakt
 * in i SQL-konsoler som bara klarar ett kommando i taget. En incheckad generat
 * kan hamna i otakt med sin källa — det här testet ser till att den inte gör
 * det, och säger vad man kör för att rätta till det.
 */
import assert from 'assert';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function runTests() {
  console.log('Running schema tests...');
  let failures = 0;

  const { splitStatements, buildSingleStatement } =
    await import('../supabase/build-single-statement.mjs');

  const schema = await readFile(join(ROOT, 'supabase/schema.sql'), 'utf8');
  const statements = splitStatements(schema);

  // Test: uppdelningen respekterar dollar-citat. En naiv split på ';' skulle
  // kapa funktionskropparna mitt itu och lämna ojämna $$-par efter sig.
  try {
    assert.ok(statements.length > 50, `orimligt få satser: ${statements.length}`);
    const uneven = statements.filter(s => (s.match(/\$\$/g) || []).length % 2);
    assert.strictEqual(uneven.length, 0, 'satser med ojämna $$ — dollar-citat kapade');
    const fns = statements.filter(s => /create or replace function/i.test(s));
    assert.ok(fns.length > 20, `orimligt få funktioner: ${fns.length}`);
    assert.ok(fns.every(s => /\$\$\s*;?\s*$/.test(s.trim())),
      'varje funktionssats ska sluta med sin avslutande $$');
    console.log('✅ statement splitting respects dollar quoting');
  } catch (err) { failures++; console.error('❌ statement splitting failed', err); }

  // Test: varje sats ryms i sin egen dollar-tagg utan krock.
  try {
    statements.forEach((s, i) => {
      assert.ok(!s.includes(`$kille_s${i + 1}$`), `taggkrock i sats ${i + 1}`);
    });
    assert.ok(!schema.includes('$kille_upgrade$'), 'yttre taggen får inte finnas i källan');
    console.log('✅ dollar tags do not collide with the schema');
  } catch (err) { failures++; console.error('❌ dollar tag check failed', err); }

  // Test: den incheckade filen är i synk med schema.sql.
  try {
    const committed = await readFile(join(ROOT, 'supabase/schema-single-statement.sql'), 'utf8');
    assert.strictEqual(
      buildSingleStatement(statements), committed,
      'schema-single-statement.sql är inaktuell — kör: node supabase/build-single-statement.mjs');
    console.log('✅ generated single-statement schema is up to date');
  } catch (err) { failures++; console.error('❌ generated schema out of sync', err); }

  if (failures > 0) {
    console.error(`${failures} test group(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All tests completed.');
}

runTests();
