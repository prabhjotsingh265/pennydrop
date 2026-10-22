import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.ts';

export * from './generated/client.ts';

export type Db = PrismaClient;

/** A database client over node-postgres. Prisma 7 talks to PostgreSQL through a driver adapter. */
export function createDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('DATABASE_URL is not set.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export {
  GONE_FOR_GOOD_STREAK,
  PRACTICE_INTERVAL_S,
  practiceTarget,
  syncTarget,
} from './watches.ts';
