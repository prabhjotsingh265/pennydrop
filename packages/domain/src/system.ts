/** The System page: how the whole platform is doing. */
export interface SystemView {
  at: string;
  queues: {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    workers: number;
  }[];
  /** Checks a minute over the last hour: those that read the page, and those that didn't. */
  throughput: { minute: string; read: number; notRead: number }[];
  /** Products due and not yet checked, and how late the oldest is. */
  due: { count: number; lagMs: number };
  sites: {
    host: string;
    breakerState: string;
    breakerOpenUntil: string | null;
    products: number;
    read: number;
    notRead: number;
  }[];
  failed: { queue: string; id: string; reason: string; at: string | null }[];
  demo: { active: number; sandboxes: number; visitors: number };
}

/** The lanes: checks since the last look, and each busy site's breaker. */
export interface LanesView {
  /** The server's clock, in ms, when it answered. */
  at: number;
  checks: {
    id: string;
    host: string;
    outcome: string;
    read: boolean;
    reason: string;
    ms: number;
    at: number;
  }[];
  sites: { host: string; breaker: string; openUntil: string | null }[];
}
