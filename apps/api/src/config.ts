import { channelsKeyFromEnv, mailSettingsFromEnv } from '@pennydrop/alerts';
import { LOCAL_PRACTICE_SHOP_URL } from '@pennydrop/domain';

export interface Config {
  /** Where people open the app; links in emails point here. */
  appUrl: string;
  authSecret: string;
  mail: { from: string; mailpitUrl?: string; resendKey?: string };
  /** Development: the practice shops at *.localhost may be added. */
  localShops: boolean;
  /** Where the browser fetcher leaves screenshots of failed checks. */
  screenshotDir?: string;
  /** Development: the container that answers for *.localhost (the practice shop and its catcher). */
  localShopHost?: string;
  /** Seals channel settings (webhook addresses, signing secrets). Must be set in production. */
  channelsKey: string;
  /**
   * Which proxies in front of the API to believe about a visitor's address
   * (X-Forwarded-For), as Fastify's `trustProxy` takes it. Off by default:
   * believing it without a proxy would let anyone pick their own address.
   */
  trustProxy: boolean | string[];
  /**
   * The demo: the practice shops' public addresses, as a template ("https://{shop}.example.com"),
   * and where the API reaches the shop's chaos controls inside the network. Without both, the
   * demo is closed.
   */
  demo: { practiceShopUrl: string; shopInternalUrl: string; chaosToken?: string } | null;
  /** Who sees the System page: email addresses, lower-cased. */
  adminEmails: string[];
  /** Production: the built React app, served by the API itself. */
  webDist?: string;
}

/** Locally, the shop container answers for every practice shop; in production, both are set. */
function demoFrom(env: NodeJS.ProcessEnv): Config['demo'] {
  const local = env.LOCAL_SHOP_HOST;
  const practiceShopUrl = env.PRACTICE_SHOP_URL || (local ? LOCAL_PRACTICE_SHOP_URL : undefined);
  const shopInternalUrl = env.SHOP_INTERNAL_URL || (local ? `http://${local}:4000` : undefined);
  if (!practiceShopUrl || !shopInternalUrl) return null;
  return { practiceShopUrl, shopInternalUrl, chaosToken: env.SHOP_CHAOS_TOKEN || undefined };
}

/** TRUST_PROXY: "true", or a comma-separated list of addresses, ranges or names such as "loopback". */
export function trustProxyFrom(value: string | undefined): Config['trustProxy'] {
  const text = value?.trim() ?? '';
  if (!text || text === 'false') return false;
  if (text === 'true') return true;
  return text.split(',').map((part) => part.trim());
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  // Empty counts as missing: .env.example leaves these blank.
  const authSecret =
    env.AUTH_SECRET || (production ? undefined : 'development-only-secret-not-for-production');
  if (!authSecret) throw new Error('AUTH_SECRET must be set in production.');
  const channelsKey = channelsKeyFromEnv(env);
  return {
    appUrl: env.APP_URL || 'http://localhost:3000',
    authSecret,
    mail: mailSettingsFromEnv(env),
    localShops: Boolean(env.LOCAL_SHOP_HOST),
    screenshotDir: env.SCREENSHOT_DIR || undefined,
    localShopHost: env.LOCAL_SHOP_HOST || undefined,
    channelsKey,
    trustProxy: trustProxyFrom(env.TRUST_PROXY),
    demo: demoFrom(env),
    webDist: env.WEB_DIST || undefined,
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  };
}
