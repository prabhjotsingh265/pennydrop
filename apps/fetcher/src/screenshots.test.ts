import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keepScreenshot } from './worker.ts';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pennydrop-shots-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const jpeg = Buffer.from('jpeg bytes');

describe('keepScreenshot', () => {
  it('keeps a failed check’s picture under its job id', async () => {
    expect(
      await keepScreenshot(dir, 'scheduled-t1-1', { outcome: 'price_not_found', screenshot: jpeg }),
    ).toBe(true);
    expect(await readFile(join(dir, 'scheduled-t1-1.jpg'))).toEqual(jpeg);
  });

  it('keeps nothing for a check that read the page, or without a picture or a folder', async () => {
    expect(await keepScreenshot(dir, 'scheduled-t2-1', { outcome: 'ok', screenshot: jpeg })).toBe(
      false,
    );
    expect(
      await keepScreenshot(dir, 'scheduled-t3-1', { outcome: 'blocked', screenshot: null }),
    ).toBe(false);
    expect(
      await keepScreenshot(undefined, 'scheduled-t4-1', { outcome: 'blocked', screenshot: jpeg }),
    ).toBe(false);
    expect(await readdir(dir)).toEqual(['scheduled-t1-1.jpg']);
  });

  it('never writes outside its folder', async () => {
    expect(await keepScreenshot(dir, '../escape', { outcome: 'blocked', screenshot: jpeg })).toBe(
      false,
    );
  });
});
