import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export const conflictMigration = new URL('../../supabase/migrations/20261114220118_business_conflicts_without_retries.sql', import.meta.url);

export async function applyBusinessConflicts(db) {
  const functions = () => db.query(`select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl,
    pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname='public' and p.prokind='f' order by p.oid`);
  const before = (await functions()).rows;
  const migration = await fs.readFile(conflictMigration, 'utf8');
  await db.exec(migration);
  const after = (await functions()).rows;
  assert.deepEqual(after, before.map(fn => ({...fn,
    definition: fn.definition.replace(/(errcode\s*=\s*)'40001'/gi, "$1'PT409'")
  })), 'Only the conflict SQLSTATE may change: preserve function identity, predicates, locks and ACLs');
  await db.exec(migration);
  assert.deepEqual((await functions()).rows, after, 'Migration is idempotent');
}
