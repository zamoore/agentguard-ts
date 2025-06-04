import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentGuard } from '../../../src/lib/agentguard.js';
import { PolicyViolationError, AgentGuardError } from '../../../src/lib/errors.js';
import { createMockPolicy, createMockToolCall } from '../../helpers/index.js';
import { mockTools } from '../../fixtures/tools.js';
import type { Policy } from '../../../src/types.js';

describe('AgentGuard', () => {
  let guard: AgentGuard;
  let allowPolicy: Policy;
  let blockPolicy: Policy;

  beforeEach(() => {
    allowPolicy = createMockPolicy({ defaultAction: 'ALLOW' });
    blockPolicy = createMockPolicy({ defaultAction: 'BLOCK' });
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with policy object', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      expect(guard.getPolicy()).toEqual(allowPolicy);
    });

    it('should initialize with policy path', async () => {
      const mockLoader = vi.fn().mockResolvedValue(allowPolicy);
      guard = new AgentGuard({ policyPath: '/path/to/policy.yaml', enableLogging: false });
      (guard as any).policyLoader.loadPolicy = mockLoader;

      await guard.initialize();

      expect(mockLoader).toHaveBeenCalledWith('/path/to/policy.yaml');
      expect(guard.getPolicy()).toEqual(allowPolicy);
    });

    it('should throw error if neither policy nor policyPath provided', async () => {
      guard = new AgentGuard({ enableLogging: false } as any);

      await expect(guard.initialize()).rejects.toThrow('No policy or policyPath provided');
    });

    it('should apply default config values', () => {
      guard = new AgentGuard({ policy: allowPolicy });

      expect((guard as any).config.enableLogging).toBe(true);
      expect((guard as any).config.timeout).toBe(30000);
      expect((guard as any).config.cache.enabled).toBe(true);
      expect((guard as any).config.cache.ttl).toBe(300000);
    });
  });

  describe('protect()', () => {
    beforeEach(async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();
    });

    it('should wrap a tool function', () => {
      const wrapped = guard.protect('test', mockTools.simpleFunction);

      expect(typeof wrapped).toBe('function');
      expect(wrapped.__agentguard_wrapped).toBe(true);
      expect(wrapped.__original_function).toBe(mockTools.simpleFunction);
    });

    it('should validate tool name', () => {
      expect(() => guard.protect('', mockTools.simpleFunction)).toThrow(
        'Tool name must be a non-empty string',
      );
      expect(() => guard.protect('   ', mockTools.simpleFunction)).toThrow(
        'Tool name must be a non-empty string',
      );
      expect(() => guard.protect(null as any, mockTools.simpleFunction)).toThrow(
        'Tool name must be a non-empty string',
      );
      expect(() => guard.protect(123 as any, mockTools.simpleFunction)).toThrow(
        'Tool name must be a non-empty string',
      );
    });

    it('should validate tool function', () => {
      expect(() => guard.protect('test', null as any)).toThrow('Tool function must be a function');
      expect(() => guard.protect('test', 'not-a-function' as any)).toThrow(
        'Tool function must be a function',
      );
      expect(() => guard.protect('test', 123 as any)).toThrow('Tool function must be a function');
    });

    it('should throw if not initialized', async () => {
      const uninitializedGuard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      const wrapped = uninitializedGuard.protect('test', mockTools.simpleFunction);

      await expect(wrapped(1, 2)).rejects.toThrow('AgentGuard not initialized');
    });

    it('should extract single object parameter', async () => {
      const mockFn = vi.fn().mockResolvedValue({ success: true });
      const wrapped = guard.protect('test', mockFn);

      await wrapped({ key: 'value', nested: { data: 123 } });

      expect(mockFn).toHaveBeenCalledWith({ key: 'value', nested: { data: 123 } });
    });

    it('should extract multiple arguments as indexed parameters', async () => {
      const mockFn = vi.fn();
      const wrapped = guard.protect('test', mockFn);

      await wrapped(1, 'two', true);

      expect(mockFn).toHaveBeenCalledWith(1, 'two', true);
    });

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
                value: 'agent-123',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction, {
        agentId: 'agent-123',
        sessionId: 'session-456',
      });

      const result = await wrapped(1, 2);
      expect(result).toBe(3);
    });

    it('should not allow modification of wrapped markers', () => {
      const wrapped = guard.protect('test', mockTools.simpleFunction);

      expect(() => {
        (wrapped as any).__agentguard_wrapped = false;
      }).toThrow();

      expect(() => {
        (wrapped as any).__original_function = null;
      }).toThrow();
    });
  });

  describe('decision outcomes', () => {
    it('should ALLOW when default action is ALLOW', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);
      const result = await wrapped(10, 20);

      expect(result).toBe(30);
    });

    it('should BLOCK when default action is BLOCK', async () => {
      guard = new AgentGuard({ policy: blockPolicy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      await expect(wrapped(1, 2)).rejects.toThrow(PolicyViolationError);
      await expect(wrapped(1, 2)).rejects.toThrow('No matching rules found');
    });

    it('should REQUIRE_HUMAN_APPROVAL and timeout', async () => {
      const approvalPolicy = createMockPolicy({
        defaultAction: 'REQUIRE_HUMAN_APPROVAL',
        webhook: { url: 'https://example.com/webhook' },
      });

      guard = new AgentGuard({ policy: approvalPolicy, enableLogging: false, timeout: 100 });
      await guard.initialize();

      global.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      await expect(wrapped(1, 2)).rejects.toThrow('Approval request timed out');
    });
  });

  describe('reloadPolicy()', () => {
    it('should reload policy from file', async () => {
      const newPolicy = createMockPolicy({ name: 'updated-policy' });
      const mockLoader = vi.fn().mockResolvedValue(newPolicy);

      guard = new AgentGuard({ policyPath: '/path/to/policy.yaml', enableLogging: false });
      (guard as any).policyLoader.loadPolicy = mockLoader;

      await guard.initialize();
      await guard.reloadPolicy();

      expect(mockLoader).toHaveBeenCalledTimes(2);
      expect(guard.getPolicy()?.name).toBe('updated-policy');
    });

    it('should warn when using provided policy', async () => {
      const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      guard = new AgentGuard({ policy: allowPolicy, enableLogging: true });
      await guard.initialize();
      await guard.reloadPolicy();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cannot reload policy when using provided policy configuration',
        }),
      );

      logSpy.mockRestore();
    });
  });

  describe('handleApprovalResponse()', () => {
    it('should delegate to HITLManager', async () => {
      guard = new AgentGuard({ policy: allowPolicy, enableLogging: false });
      await guard.initialize();

      const mockResponse = {
        requestId: 'test-123',
        decision: 'APPROVE' as const,
        approvedBy: 'user',
      };

      const mockHandleApprovalResponse = vi.fn().mockResolvedValue(undefined);
      vi.spyOn((guard as any).hitlManager, 'handleApprovalResponse').mockImplementation(
        mockHandleApprovalResponse,
      );

      await guard.handleApprovalResponse(mockResponse, {});

      expect(mockHandleApprovalResponse).toHaveBeenCalledWith(mockResponse, {});
    });
  });
});
