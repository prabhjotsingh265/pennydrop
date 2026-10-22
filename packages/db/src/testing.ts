import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDb, type Db } from './index.ts';

/**
 * Each package gets its own test database, "<name>_<package>_test", so test
 * runs in parallel never empty each other's tables. Anything not ending in
 * "_test" is refused: tests must never touch the database you click around in.
 */
export function testDatabaseUrl(suite: string): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set.');
  const url = new URL(base);
  const name = url.pathname.slice(1).replace(/_test$/, '');
  url.pathname = `/${name}_${suite}_test`;
  return url.toString();
}

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": test databases end in "_test".`);
  }
}

/** Creates the suite's database if it's missing, and applies every migration. */
export async function prepareTestDatabase(suite: string): Promise<string> {
  const url = testDatabaseUrl(suite);
  assertTestDatabase(url);
  const name = new URL(url).pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await client.end();
  }

  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  return url;
}

/** A client for a suite's test database. */
export function testDb(suite: string): Db {
  const url = testDatabaseUrl(suite);
  assertTestDatabase(url);
  return createDb(url);
}

/** Empties every table, between tests. */
export async function resetDatabase(db: Db): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE deliveries, alerts, channels, alert_rules, watches, product_groups, memberships, workspaces, verifications, accounts, sessions, users, events, price_points, checks, recipes, targets, sites RESTART IDENTITY CASCADE',
  );
}
