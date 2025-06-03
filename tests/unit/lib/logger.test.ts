import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Logger } from '../../../src/lib/logger.js';

describe('Logger', () => {
  let consoleSpy: {
    debug: any;
    info: any;
    warn: any;
    error: any;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('logging levels', () => {
    it('should log when enabled', () => {
      const logger = new Logger({ enabled: true });

      logger.info('test message', { data: 123 });

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'INFO',
          message: 'test message',
          data: { data: 123 },
        }),
      );
    });

    it('should not log when disabled', () => {
      const logger = new Logger({ enabled: false });

      logger.info('test message');
      logger.debug('debug message');
      logger.warn('warning message');
      logger.error('error message');

      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });

    it('should respect minimum log level', () => {
      const logger = new Logger({ enabled: true, minLevel: 'warn' });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warning message');
      logger.error('error message');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    it('should use appropriate console methods', () => {
      const logger = new Logger({ enabled: true });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('log format', () => {
    it('should include timestamp', () => {
      const logger = new Logger({ enabled: true });
      const beforeTime = new Date().toISOString();

      logger.info('test');

      const afterTime = new Date().toISOString();
      const logEntry = consoleSpy.info.mock.calls[0][0];

      expect(new Date(logEntry.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeTime).getTime(),
      );
      expect(new Date(logEntry.timestamp).getTime()).toBeLessThanOrEqual(
        new Date(afterTime).getTime(),
      );
    });

    it('should uppercase log level', () => {
      const logger = new Logger({ enabled: true });

      logger.debug('test');
      logger.info('test');
      logger.warn('test');
      logger.error('test');

      expect(consoleSpy.debug.mock.calls[0][0].level).toBe('DEBUG');
      expect(consoleSpy.info.mock.calls[0][0].level).toBe('INFO');
      expect(consoleSpy.warn.mock.calls[0][0].level).toBe('WARN');
      expect(consoleSpy.error.mock.calls[0][0].level).toBe('ERROR');
    });
  });

  describe('custom handler', () => {
    it('should use custom log handler', () => {
      const handler = vi.fn();
      const logger = new Logger({ enabled: true, handler });

      logger.info('test message', { custom: true });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
          level: 'INFO',
          message: 'test message',
          data: { custom: true },
        }),
      );
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('should pass undefined handler to default logging', () => {
      const logger = new Logger({ enabled: true, handler: undefined });

      logger.info('test');

      expect(consoleSpy.info).toHaveBeenCalled();
    });
  });

  describe('isEnabled()', () => {
    it('should return enabled state', () => {
      const logger1 = new Logger({ enabled: true });
      const logger2 = new Logger({ enabled: false });

      expect(logger1.isEnabled()).toBe(true);
      expect(logger2.isEnabled()).toBe(false);
    });
  });

  describe('default values', () => {
    it('should default to enabled', () => {
      const logger = new Logger();
      expect(logger.isEnabled()).toBe(true);
    });

    it('should default to debug level', () => {
      const logger = new Logger();
      logger.debug('test');
      expect(consoleSpy.debug).toHaveBeenCalled();
    });
  });
});
