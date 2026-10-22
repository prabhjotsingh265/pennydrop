import { describe, expect, it } from 'vitest';
import { screenshotPath } from './screenshots.ts';

describe('screenshotPath', () => {
  it('names a screenshot by its check job', () => {
    expect(screenshotPath('/shots', 'scheduled-01a1-1792592956010')).toBe(
      '/shots/scheduled-01a1-1792592956010.jpg',
    );
  });

  it('never leaves the folder', () => {
    expect(screenshotPath('/shots', '../etc/passwd')).toBeNull();
    expect(screenshotPath('/shots', 'a/b')).toBeNull();
    expect(screenshotPath('/shots', '')).toBeNull();
  });
});
