import { describe, expect, it } from 'vitest';
import { spreadLabels } from './CompareChart.tsx';

describe('spreadLabels', () => {
  it('moves labels apart just enough, keeping their order', () => {
    expect(spreadLabels([100, 104, 300], 15)).toEqual([100, 115, 300]);
    // Given in any order, each label keeps its own place in the answer.
    expect(spreadLabels([50, 10, 12], 15)).toEqual([50, 10, 25]);
  });
});
