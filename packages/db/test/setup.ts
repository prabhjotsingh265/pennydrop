import { prepareTestDatabase } from '../src/testing.ts';

export default async function setup() {
  await prepareTestDatabase('db');
}
