#!/usr/bin/env node
/**
 * Kille — bygger schema.sql som EN enda SQL-sats.
 *
 * Vissa SQL-konsoler (t.ex. Vercels query-vy för Supabase) skickar det man
 * klistrar in som en *förberedd sats*. PostgreSQL tillåter bara ett kommando
 * per förberedd sats, så hela schemat avvisas med
 *
 *     cannot insert multiple commands into a prepared statement
 *
 * Det här skriptet delar schema.sql i dess enskilda satser och bakar in dem i
 * ett `do $$ ... $$`-block där varje sats körs med EXECUTE. Blocket är ETT
 * kommando och går därför igenom även i sådana konsoler. Som bonus körs allt i
 * en transaktion: går något fel rullas hela uppgraderingen tillbaka.
 *
 * Innehållet är oförändrat — skriptet flyttar bara satserna, det skriver inte
 * om dem. Kör om det när schema.sql har ändrats.
 *
 *   node supabase/build-single-statement.mjs [utfil]
 *
 * Utan argument skrivs resultatet till supabase/schema-single-statement.sql.
 */
import { readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = join(HERE, 'schema.sql');
const OUTPUT = resolve(process.argv[2] || join(HERE, 'schema-single-statement.sql'));

/**
 * Dela upp SQL i enskilda satser.
 *
 * En enkel split på ';' duger inte: funktionskropparna är dollar-citerade
 * ($$ ... $$) och full av semikolon. Vi går därför igenom tecken för tecken och
 * hoppar över kommentarer, stränglitteraler och dollar-citat.
 *
 * @param {string} sql
 * @returns {string[]} satserna, utan avslutande semikolon
 */
export function splitStatements(sql) {
  const statements = [];
  let buf = '';
  let i = 0;

  const push = () => {
    const stmt = buf.trim();
    // Hoppa över "satser" som bara är kommentarer eller blanktecken.
    const hasCode = stmt.split('\n').some(l => l.trim() && !l.trim().startsWith('--'));
    if (hasCode) statements.push(stmt.replace(/;$/, '').trim());
    buf = '';
  };

  while (i < sql.length) {
    // Radkommentar
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end + 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Blockkommentar
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i);
      const stop = end === -1 ? sql.length : end + 2;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Stränglitteral, med '' som escape
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Dollar-citat: $$ ... $$ eller $tag$ ... $tag$
    const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
    if (tag) {
      const close = sql.indexOf(tag[0], i + tag[0].length);
      const stop = close === -1 ? sql.length : close + tag[0].length;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === ';') { buf += ';'; push(); i += 1; continue; }

    buf += sql[i];
    i += 1;
  }
  push();
  return statements;
}

/** Bygg DO-blocket. Varje sats får en egen dollar-tagg så inget krockar. */
export function buildSingleStatement(statements) {
  const body = statements.map((stmt, idx) => {
    const tag = `$kille_s${idx + 1}$`;
    if (stmt.includes(tag)) {
      throw new Error(`Dollar-taggen ${tag} förekommer i sats ${idx + 1} — välj en annan prefix.`);
    }
    return `  execute ${tag}${stmt}${tag};`;
  }).join('\n');

  const outer = '$kille_upgrade$';
  if (body.includes(outer)) throw new Error('Yttre dollar-taggen krockar med innehållet.');

  return `-- ═══════════════════════════════════════════════════════════════════════════
-- Kille — hela schemat som EN sats  (GENERERAD FIL — redigera inte)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bygg om med:  node supabase/build-single-statement.mjs
-- Källa:        supabase/schema.sql
--
-- För SQL-konsoler som bara klarar ett kommando i taget (t.ex. Vercels
-- query-vy för Supabase), som annars svarar:
--   "cannot insert multiple commands into a prepared statement"
--
-- Identiskt innehåll med schema.sql — de ${statements.length} satserna körs här via EXECUTE
-- inuti ett DO-block, vilket räknas som ett enda kommando. Allt körs i en
-- transaktion: går något fel rullas hela uppgraderingen tillbaka.
--
-- Markera ALLT nedan och kör.
-- ═══════════════════════════════════════════════════════════════════════════
do ${outer}
begin
${body}
end
${outer};
`;
}

const statements = splitStatements(await readFile(INPUT, 'utf8'));
await writeFile(OUTPUT, buildSingleStatement(statements), 'utf8');
console.log(`${statements.length} satser → ${OUTPUT}`);
