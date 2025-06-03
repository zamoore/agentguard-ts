import { describe, it, expect } from 'vitest';
import {
  AgentGuardError,
  PolicyViolationError,
  ApprovalTimeoutError,
  PolicyLoadError,
} from '../../../src/lib/errors.js';
import { createMockToolCall } from '../../helpers/index.js';
import type { PolicyRule } from '../../../src/types.js';

describe('Error Classes', () => {
  describe('AgentGuardError', () => {
    it('should create error with code and details', () => {
      const error = new AgentGuardError('Test error', 'TEST_CODE', { foo: 'bar' });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ foo: 'bar' });
      expect(error.name).toBe('AgentGuardError');
    });

    it('should create error without details', () => {
      const error = new AgentGuardError('Test error', 'TEST_CODE');

      expect(error.details).toBeUndefined();
    });
  });

  describe('PolicyViolationError', () => {
    it('should extend AgentGuardError', () => {
      const rule: PolicyRule = {
        name: 'test-rule',
        action: 'BLOCK',
        conditions: [],
      };
      const toolCall = createMockToolCall();
      const error = new PolicyViolationError('Violation', rule, toolCall);

      expect(error).toBeInstanceOf(AgentGuardError);
      expect(error).toBeInstanceOf(PolicyViolationError);
    });

    it('should include rule and toolCall', () => {
      const rule: PolicyRule = {
        name: 'test-rule',
        action: 'BLOCK',
        conditions: [
          {
            field: 'test',
            operator: 'equals',
            value: 'value',
          },
        ],
      };
      const toolCall = createMockToolCall({ toolName: 'dangerous-tool' });
      const error = new PolicyViolationError('Policy violated', rule, toolCall);

      expect(error.rule).toBe(rule);
      expect(error.toolCall).toBe(toolCall);
      expect(error.code).toBe('POLICY_VIOLATION');
      expect(error.details).toEqual({ rule, toolCall });
    });
  });

  describe('ApprovalTimeoutError', () => {
    it('should include request ID', () => {
      const error = new ApprovalTimeoutError('Timeout occurred', 'req-123');

      expect(error).toBeInstanceOf(AgentGuardError);
      expect(error.requestId).toBe('req-123');
      expect(error.code).toBe('APPROVAL_TIMEOUT');
      expect(error.details).toEqual({ requestId: 'req-123' });
    });
  });

  describe('PolicyLoadError', () => {
    it('should include policy path', () => {
      const error = new PolicyLoadError('Failed to load', '/path/to/policy.yaml');

      expect(error).toBeInstanceOf(AgentGuardError);
      expect(error.policyPath).toBe('/path/to/policy.yaml');
      expect(error.code).toBe('POLICY_LOAD_ERROR');
      expect(error.details).toEqual({ policyPath: '/path/to/policy.yaml' });
    });

    it('should handle undefined path', () => {
      const error = new PolicyLoadError('Failed to load');

      expect(error.policyPath).toBeUndefined();
      expect(error.details).toEqual({ policyPath: undefined });
    });
  });
});
