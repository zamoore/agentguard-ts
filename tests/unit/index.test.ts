import { describe, it, expect } from 'vitest';
import {
  AgentGuard,
  createAgentGuard,
  PolicyLoader,
  HITLManager,
  Logger,
  AgentGuardError,
  PolicyViolationError,
  ApprovalTimeoutError,
  PolicyLoadError,
  version,
  getVersionString,
} from '../../src/index.js';

describe('Package Exports', () => {
  describe('main exports', () => {
    it('should export AgentGuard class', () => {
      expect(AgentGuard).toBeDefined();
      expect(typeof AgentGuard).toBe('function');
    });

    it('should export utility classes', () => {
      expect(PolicyLoader).toBeDefined();
      expect(HITLManager).toBeDefined();
      expect(Logger).toBeDefined();
    });

    it('should export error classes', () => {
      expect(AgentGuardError).toBeDefined();
      expect(PolicyViolationError).toBeDefined();
      expect(ApprovalTimeoutError).toBeDefined();
      expect(PolicyLoadError).toBeDefined();

      // Test inheritance
      expect(new PolicyViolationError('test', {} as any, {} as any)).toBeInstanceOf(
        AgentGuardError,
      );
    });
  });

  describe('factory function', () => {
    it('should export createAgentGuard', () => {
      expect(createAgentGuard).toBeDefined();
      expect(typeof createAgentGuard).toBe('function');
    });

    it('should create AgentGuard instance', () => {
      const guard = createAgentGuard({
        policy: {
          version: '1.0',
          name: 'test',
          defaultAction: 'ALLOW',
          rules: [],
        },
      });

      expect(guard).toBeInstanceOf(AgentGuard);
    });
  });

  describe('version exports', () => {
    it('should export version information', () => {
      expect(version).toBeDefined();
      expect(typeof version).toBe('string');
    });

    it('should export version functions', () => {
      expect(getVersionString).toBeDefined();
      expect(typeof getVersionString()).toBe('string');
      expect(getVersionString()).toContain('@zamoore/agentguard-ts');
    });
  });

  describe('default export', () => {
    it('should have AgentGuard as default export', async () => {
      const module = await import('../../src/index.js');
      expect(module.default).toBe(AgentGuard);
    });
  });
});
