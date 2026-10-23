import { pino, type Logger } from 'pino';

export type Log = Logger;

/**
 * The worker's and the fetchers' logs: one JSON object a line, as the API's (Fastify's own
 * pino), so a check can be followed from its fetch to its record by its job id. LOG_LEVEL
 * says how much: "info" by default, "debug" for every job put back for its site's pace.
 */
export function createLog(service: string): Log {
  return pino({ level: process.env.LOG_LEVEL || 'info' }).child({ service });
}
