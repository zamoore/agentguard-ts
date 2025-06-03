import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentGuard } from '../../src/lib/agentguard.js';
import { createMockPolicy } from '../helpers/index.js';
import { mockTools } from '../fixtures/tools.js';
import type { Policy } from '../../src/types.js';

describe('Interceptor Unit Tests', () => {
  let guard: AgentGuard;
  let allowPolicy: Policy;
  let blockPolicy: Policy;

  beforeEach(async () => {
    allowPolicy = createMockPolicy({
      defaultAction: 'ALLOW',
      rules: [],
    });

    blockPolicy = createMockPolicy({
      defaultAction: 'BLOCK',
      rules: [],
    });
  });

  describe('Tool Wrapping', () => {
    it('should wrap a tool function and maintain function signature', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('simpleFunction', mockTools.simpleFunction);

      expect(typeof wrapped).toBe('function');
      expect(wrapped.length).toBe(mockTools.simpleFunction.length);
      expect(wrapped.__agentguard_wrapped).toBe(true);
      expect(wrapped.__original_function).toBe(mockTools.simpleFunction);
    });

    it('should extract parameters correctly for single object parameter', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn().mockResolvedValue({ success: true });
      const wrapped = guard.protect('test', mockFn);

      await wrapped({ key: 'value', nested: { data: 123 } });

      // The wrapped function should have been called with original params
      expect(mockFn).toHaveBeenCalledWith({ key: 'value', nested: { data: 123 } });
    });

    it('should extract parameters correctly for multiple arguments', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn().mockImplementation((a, b, c) => a + b + c);
      const wrapped = guard.protect('test', mockFn);

      const result = await wrapped(1, 2, 3);

      expect(mockFn).toHaveBeenCalledWith(1, 2, 3);
      expect(result).toBe(6);
    });

    it('should handle async functions correctly', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('asyncFunction', mockTools.asyncFunction);
      const result = await wrapped({ message: 'test' });

      expect(result).toEqual({ success: true, echo: 'test' });
    });

    it('should propagate errors from wrapped functions', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('errorFunction', mockTools.errorFunction);

      await expect(wrapped()).rejects.toThrow('Tool execution failed');
    });

    it('should throw error if guard not initialized', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      await expect(wrapped(1, 2)).rejects.toThrow('AgentGuard not initialized');
    });
  });

  describe('Metadata and Context', () => {
    it('should include agentId and sessionId when provided', async () => {
      const policy = createMockPolicy({
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'test-rule',
            action: 'ALLOW',
            conditions: [
              {
                field: 'toolCall.agentId',
                operator: 'equals',
                value: 'special-agent',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction, {
        agentId: 'special-agent',
        sessionId: 'session-123',
      });

      const result = await wrapped(1, 2);
      expect(result).toBe(3); // Should be allowed due to matching agentId
    });

    it('should include custom metadata', async () => {
      const policy = createMockPolicy({
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'metadata-rule',
            action: 'ALLOW',
            conditions: [
              {
                field: 'toolCall.metadata.environment',
                operator: 'equals',
                value: 'production',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction, {
        metadata: { environment: 'production', version: '1.0' },
      });

      const result = await wrapped(5, 10);
      expect(result).toBe(15);
    });
  });

  describe('Function Identity', () => {
    it('should mark wrapped functions with __agentguard_wrapped', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      expect(wrapped.__agentguard_wrapped).toBe(true);
      expect(wrapped.__original_function).toBe(mockTools.simpleFunction);
    });

    it('should not allow modification of wrapped function markers', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      // Try to modify the markers
      expect(() => {
        (wrapped as any).__agentguard_wrapped = false;
      }).toThrow();

      expect(() => {
        (wrapped as any).__original_function = null;
      }).toThrow();
    });
  });

  describe('Parameter Extraction Edge Cases', () => {
    it('should handle no parameters', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn().mockResolvedValue('no params');
      const wrapped = guard.protect('test', mockFn);

      await wrapped();

      expect(mockFn).toHaveBeenCalledWith();
    });

    it('should handle null as first parameter', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn();
      const wrapped = guard.protect('test', mockFn);

      await wrapped(null);

      expect(mockFn).toHaveBeenCalledWith(null);
    });

    it('should handle array as first parameter', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn();
      const wrapped = guard.protect('test', mockFn);

      await wrapped([1, 2, 3]);

      expect(mockFn).toHaveBeenCalledWith([1, 2, 3]);
    });
  });

  describe('Blocking Behavior', () => {
    it('should block tool calls when policy defaultAction is BLOCK', async () => {
      guard = new AgentGuard({ policy: blockPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      await expect(wrapped(1, 2)).rejects.toThrow('Tool call blocked by policy');
      await expect(wrapped(1, 2)).rejects.toThrow('PolicyViolationError');
    });

    it('should not call original function when blocked', async () => {
      guard = new AgentGuard({ policy: blockPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn().mockResolvedValue('should not be called');
      const wrapped = guard.protect('test', mockFn);

      await expect(wrapped({ data: 'test' })).rejects.toThrow();
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should block with custom rule that overrides default ALLOW', async () => {
      const mixedPolicy = createMockPolicy({
        defaultAction: 'ALLOW',
        rules: [
          {
            name: 'block-specific-tool',
            action: 'BLOCK',
            conditions: [
              {
                field: 'toolCall.toolName',
                operator: 'equals',
                value: 'dangerous-tool',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy: mixedPolicy, enableLogging: false });
      await guard.initialize();

      const safeTool = vi.fn().mockResolvedValue('allowed');
      const dangerousTool = vi.fn().mockResolvedValue('should be blocked');

      const wrappedSafe = guard.protect('safe-tool', safeTool);
      const wrappedDangerous = guard.protect('dangerous-tool', dangerousTool);

      // Safe tool should be allowed
      await expect(wrappedSafe({})).resolves.toBe('allowed');
      expect(safeTool).toHaveBeenCalled();

      // Dangerous tool should be blocked
      await expect(wrappedDangerous({})).rejects.toThrow('Tool call blocked by policy');
      expect(dangerousTool).not.toHaveBeenCalled();
    });

    it('should include rule and toolCall information in PolicyViolationError', async () => {
      const blockingPolicy = createMockPolicy({
        defaultAction: 'ALLOW',
        rules: [
          {
            name: 'test-blocking-rule',
            action: 'BLOCK',
            conditions: [
              {
                field: 'toolCall.parameters.action',
                operator: 'equals',
                value: 'delete',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy: blockingPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn().mockResolvedValue({ success: true });
      const wrapped = guard.protect('test-tool', mockFn);

      // Test that it throws PolicyViolationError
      await expect(wrapped({ action: 'delete', id: 123 })).rejects.toThrow(
        'Tool call blocked by policy',
      );

      // Test error properties separately
      let thrownError: any;
      try {
        await wrapped({ action: 'delete', id: 123 });
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError.name).toBe('PolicyViolationError');
      expect(thrownError.rule).toBeDefined();
      expect(thrownError.rule.name).toBe('test-blocking-rule');
      expect(thrownError.toolCall).toBeDefined();
      expect(thrownError.toolCall.toolName).toBe('test-tool');
      expect(thrownError.toolCall.parameters).toEqual({ action: 'delete', id: 123 });
    });

    it('should block with multiple condition rule', async () => {
      const complexBlockingPolicy = createMockPolicy({
        defaultAction: 'ALLOW',
        rules: [
          {
            name: 'block-admin-deletes',
            action: 'BLOCK',
            conditions: [
              {
                field: 'toolCall.toolName',
                operator: 'contains',
                value: 'admin',
              },
              {
                field: 'toolCall.parameters.operation',
                operator: 'equals',
                value: 'delete',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy: complexBlockingPolicy, enableLogging: false });
      await guard.initialize();

      const mockFn = vi.fn();
      const wrapped = guard.protect('admin-tool', mockFn);

      // Should be blocked because both conditions match
      await expect(wrapped({ operation: 'delete' })).rejects.toThrow('Tool call blocked by policy');
      expect(mockFn).not.toHaveBeenCalled();

      // Should be allowed because only one condition matches
      await wrapped({ operation: 'read' });
      expect(mockFn).toHaveBeenCalledWith({ operation: 'read' });
    });

    it('should handle async tool functions when blocking', async () => {
      guard = new AgentGuard({ policy: blockPolicy, enableLogging: false });
      await guard.initialize();

      const asyncTool = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'should not be reached';
      });

      const wrapped = guard.protect('async-tool', asyncTool);

      await expect(wrapped({})).rejects.toThrow('Tool call blocked by policy');
      expect(asyncTool).not.toHaveBeenCalled();
    });
  });
});
