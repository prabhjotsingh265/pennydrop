import { join } from 'node:path';

/** Screenshots of failed checks are kept this long. */
export const SCREENSHOT_KEEP_DAYS = 7;

/**
 * Where a check's screenshot lives, named by its job id. Anything but letters,
 * digits, "-" and "_" is refused, so a key can never point outside the folder.
 */
export function screenshotPath(dir: string, key: string): string | null {
  return /^[\w-]{1,200}$/.test(key) ? join(dir, `${key}.jpg`) : null;
}
