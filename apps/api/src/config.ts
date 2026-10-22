export interface Config {
  /** Where people open the app; links in emails point here. */
  appUrl: string;
  authSecret: string;
  mail: { from: string; mailpitUrl?: string; resendKey?: string };
  /** Development: the practice shops at *.localhost may be added. */
  localShops: boolean;
  /** Where the browser fetcher leaves screenshots of failed checks. */
  screenshotDir?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  // Empty counts as missing: .env.example leaves these blank.
  const authSecret =
    env.AUTH_SECRET || (production ? undefined : 'development-only-secret-not-for-production');
  if (!authSecret) throw new Error('AUTH_SECRET must be set in production.');
  return {
    appUrl: env.APP_URL || 'http://localhost:3000',
    authSecret,
    mail: {
      from: env.MAIL_FROM || 'Pennydrop <hello@pennydrop.test>',
      mailpitUrl: env.MAILPIT_URL || undefined,
      resendKey: env.RESEND_API_KEY || undefined,
    },
    localShops: Boolean(env.LOCAL_SHOP_HOST),
    screenshotDir: env.SCREENSHOT_DIR || undefined,
  };
}
