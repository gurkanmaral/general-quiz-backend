import { pino, type Logger } from 'pino';

export type { Logger };

/** The one application logger. Never log tokens or emails. */
export function createLogger(level: string = 'info'): Logger {
  return pino({
    level,
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.email', '*.password', '*.token'], remove: true },
  });
}
