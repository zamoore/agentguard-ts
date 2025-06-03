import { describe, it, expect } from 'vitest';
import { AgentGuard, createAgentGuard } from '../src/index.js';
import {
  PolicyLoader,
  HITLManager,
  Logger,
  AgentGuardError,
  PolicyViolationError,
  ApprovalTimeoutError,
  PolicyLoadError,
} from '../src/index.js';
import * as version from '../src/version.js';

describe('AgentGuard Package Exports', () => {
  it('should export main classes', () => {
    expect(AgentGuard).toBeDefined();
    expect(PolicyLoader).toBeDefined();
    expect(HITLManager).toBeDefined();
    expect(Logger).toBeDefined();
  });

  it('should export error classes', () => {
    expect(AgentGuardError).toBeDefined();
    expect(PolicyViolationError).toBeDefined();
    expect(ApprovalTimeoutError).toBeDefined();
    expect(PolicyLoadError).toBeDefined();
  });

  it('should export factory function', () => {
    expect(createAgentGuard).toBeDefined();
    expect(typeof createAgentGuard).toBe('function');

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

  it('should export version information', () => {
    expect(version.version).toBeDefined();
    expect(version.name).toBe('@zamoore/agentguard-ts');
    expect(version.getVersionString).toBeDefined();
    expect(typeof version.getVersionString()).toBe('string');
  });
});
