import type { LogLevel, LogEntry, LogHandler } from '../types.js';

export class Logger {
  private readonly enabled: boolean;
  private readonly minLevel: LogLevel;
  private readonly handler: LogHandler | undefined;

  constructor(options?: { enabled?: boolean; minLevel?: LogLevel; handler?: LogHandler }) {
    this.enabled = options?.enabled ?? true;
    this.minLevel = options?.minLevel ?? 'debug';
    this.handler = options?.handler;
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: any): void {
    this.log('error', message, error);
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];

    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.enabled || !this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...(data && { data }),
    };

    if (this.handler !== undefined) {
      this.handler(logEntry);
    } else {
      // Use appropriate console method with structured log entry
      switch (level) {
        case 'debug':
          console.debug(logEntry);
          break;
        case 'info':
          console.info(logEntry);
          break;
        case 'warn':
          console.warn(logEntry);
          break;
        case 'error':
          console.error(logEntry);
          break;
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
