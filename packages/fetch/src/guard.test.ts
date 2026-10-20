import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './guard.ts';

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'lets %s through',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:7f00:1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    '[::1]',
    'not-an-address',
  ])('stops %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
