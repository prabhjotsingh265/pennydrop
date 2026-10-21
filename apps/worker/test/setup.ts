import { prepareTestDatabase } from '@pennydrop/db/testing';

export default async function setup() {
  await prepareTestDatabase('worker');
}
