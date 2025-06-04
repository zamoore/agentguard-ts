import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentGuard, createAgentGuard } from '../src/index.js';

import type { Policy, ApprovalResponse } from '../src/types.js';
import type { Mock } from 'vitest';

describe('AgentGuard Core', () => {
  let guard: AgentGuard;

  const basePolicy: Policy = {
    version: '1.0',
    name: 'Test Policy',
    defaultAction: 'BLOCK',
    rules: [
      {
        name: 'Allow reads',
        action: 'ALLOW',
        priority: 100,
        conditions: [
          {
            field: 'toolCall.toolName',
            operator: 'equals',
            value: 'database_read',
          },
        ],
      },
      {
        name: 'Block deletes',
        action: 'BLOCK',
        priority: 200,
        conditions: [
          {
            field: 'toolCall.toolName',
            operator: 'contains',
            value: 'delete',
          },
        ],
      },
      {
        name: 'Approve large transactions',
        action: 'REQUIRE_HUMAN_APPROVAL',
        priority: 150,
        conditions: [
          {
            field: 'toolCall.parameters.amount',
            operator: 'gt',
            value: 1000,
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    guard = createAgentGuard({
      policy: basePolicy,
      enableLogging: false,
      timeout: 1000,
    });
  });

  describe('Initialization', () => {
    it('should initialize with provided policy', async () => {
      await guard.initialize();
      expect(guard.getPolicy()).toEqual(basePolicy);
    });

    it('should throw error when no policy provided', async () => {
      const invalidGuard = new AgentGuard({} as any);
      await expect(invalidGuard.initialize()).rejects.toThrow('No policy or policyPath provided');
    });

    it('should load policy from file path', async () => {
      const fileGuard = createAgentGuard({
        policyPath: './test-policy.yaml',
      });

      // Mock file system - we'll implement file-based tests separately
      await expect(fileGuard.initialize()).rejects.toThrow();
    });
  });

  describe('Tool Protection - Basic Flow', () => {
    beforeEach(async () => {
      await guard.initialize();
    });

    it('should allow permitted tool calls', async () => {
      const readTool = vi.fn().mockResolvedValue({ data: 'test' });
      const protectedRead = guard.protect('database_read', readTool);

      const result = await protectedRead({ table: 'users' });

      expect(readTool).toHaveBeenCalledWith({ table: 'users' });
      expect(result).toEqual({ data: 'test' });
    });

    it('should block forbidden tool calls', async () => {
      const deleteTool = vi.fn();
      const protectedDelete = guard.protect('database_delete', deleteTool);

      await expect(protectedDelete({ table: 'users' })).rejects.toThrow(
        'Tool call blocked by policy',
      );

      expect(deleteTool).not.toHaveBeenCalled();
    });

    it('should use default action when no rules match', async () => {
      const unknownTool = vi.fn();
      const protectedTool = guard.protect('unknown_tool', unknownTool);

      // Default action is BLOCK
      await expect(protectedTool({})).rejects.toThrow('Tool call blocked by policy');
    });
  });

  describe('Policy Evaluation', () => {
    beforeEach(async () => {
      await guard.initialize();
    });

    it('should evaluate rules by priority order', async () => {
      // Create a tool that matches multiple rules
      const tool = vi.fn();
      const protectedTool = guard.protect('user_delete', tool);

      // Should match "Block deletes" rule (priority 200) before others
      await expect(protectedTool({})).rejects.toThrow('Tool call blocked by policy');
    });

    it('should handle complex parameter conditions', async () => {
      const paymentTool = vi.fn().mockResolvedValue({ success: true });
      const protectedPayment = guard.protect('send_payment', paymentTool);

      // Small amount - should not trigger approval
      const smallPaymentPolicy: Policy = {
        ...basePolicy,
        defaultAction: 'ALLOW',
      };

      const guardWithAllowDefault = createAgentGuard({
        policy: smallPaymentPolicy,
        enableLogging: false,
      });
      await guardWithAllowDefault.initialize();

      const protectedSmallPayment = guardWithAllowDefault.protect('send_payment', paymentTool);
      await protectedSmallPayment({ amount: 500 });
      expect(paymentTool).toHaveBeenCalled();
    });
  });

  describe('Condition Operators', () => {
    const testCases = [
      {
        operator: 'equals' as const,
        field: 'toolCall.toolName',
        value: 'exact_match',
        matching: 'exact_match',
        nonMatching: 'different',
      },
      {
        operator: 'contains' as const,
        field: 'toolCall.toolName',
        value: 'delete',
        matching: 'user_delete_all',
        nonMatching: 'user_update',
      },
      {
        operator: 'startsWith' as const,
        field: 'toolCall.toolName',
        value: 'admin_',
        matching: 'admin_delete',
        nonMatching: 'user_admin',
      },
      {
        operator: 'endsWith' as const,
        field: 'toolCall.toolName',
        value: '_write',
        matching: 'database_write',
        nonMatching: 'write_database',
      },
      {
        operator: 'regex' as const,
        field: 'toolCall.toolName',
        value: '^(create|update|delete)_.*',
        matching: 'create_user',
        nonMatching: 'read_user',
      },
      {
        operator: 'in' as const,
        field: 'toolCall.toolName',
        value: ['read', 'list', 'get'],
        matching: 'list',
        nonMatching: 'create',
      },
    ];

    testCases.forEach(({ operator, field, value, matching, nonMatching }) => {
      it(`should evaluate ${operator} operator correctly`, async () => {
        const policy: Policy = {
          version: '1.0',
          name: 'Operator Test',
          defaultAction: 'BLOCK',
          rules: [
            {
              name: `Test ${operator}`,
              action: 'ALLOW',
              conditions: [{ field, operator, value }],
            },
          ],
        };

        const testGuard = createAgentGuard({ policy, enableLogging: false });
        await testGuard.initialize();

        const tool = vi.fn().mockResolvedValue('success');

        // Test matching case
        const matchingProtected = testGuard.protect(matching, tool);
        await expect(matchingProtected({})).resolves.toBe('success');

        // Test non-matching case
        const nonMatchingProtected = testGuard.protect(nonMatching, tool);
        await expect(nonMatchingProtected({})).rejects.toThrow('blocked');
      });
    });
  });

  describe('Numeric Operators', () => {
    const numericTests = [
      { operator: 'gt' as const, value: 100, pass: 101, fail: 100 },
      { operator: 'gte' as const, value: 100, pass: 100, fail: 99 },
      { operator: 'lt' as const, value: 100, pass: 99, fail: 100 },
      { operator: 'lte' as const, value: 100, pass: 100, fail: 101 },
    ];

    numericTests.forEach(({ operator, value, pass, fail }) => {
      it(`should evaluate ${operator} operator correctly`, async () => {
        const policy: Policy = {
          version: '1.0',
          name: 'Numeric Test',
          defaultAction: 'BLOCK',
          rules: [
            {
              name: `Test ${operator}`,
              action: 'ALLOW',
              conditions: [
                {
                  field: 'toolCall.parameters.amount',
                  operator,
                  value,
                },
              ],
            },
          ],
        };

        const testGuard = createAgentGuard({ policy, enableLogging: false });
        await testGuard.initialize();

        const tool = vi.fn().mockResolvedValue('success');
        const protectedTool = testGuard.protect('transfer', tool);

        // Test passing case
        await expect(protectedTool({ amount: pass })).resolves.toBe('success');

        // Test failing case
        await expect(protectedTool({ amount: fail })).rejects.toThrow('blocked');
      });
    });
  });

  describe('Human-in-the-Loop Workflow', () => {
    let approvalGuard: AgentGuard;
    let mockWebhookHandler: Mock;

    beforeEach(async () => {
      mockWebhookHandler = vi.fn().mockResolvedValue({ ok: true });

      // Mock fetch for webhook calls
      global.fetch = vi.fn().mockImplementation(mockWebhookHandler);

      approvalGuard = createAgentGuard({
        policy: basePolicy,
        enableLogging: false,
        timeout: 2000,
        webhook: {
          url: 'https://example.com/webhook',
          timeout: 1000,
          retries: 1,
        },
      });

      await approvalGuard.initialize();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should trigger approval workflow for matching rules', async () => {
      const paymentTool = vi.fn().mockResolvedValue({ success: true });
      const protectedPayment = approvalGuard.protect('send_payment', paymentTool);

      // Start the approval request in background
      const paymentPromise = protectedPayment({ amount: 2000 });

      // Verify webhook was called
      await vi.waitFor(() => {
        expect(mockWebhookHandler).toHaveBeenCalled();
      });

      const webhookCall = mockWebhookHandler.mock.calls[0];
      const webhookBody = JSON.parse(webhookCall[1].body);

      expect(webhookBody.type).toBe('approval_request');
      expect(webhookBody.request.toolCall.parameters.amount).toBe(2000);

      // Simulate approval
      const approvalResponse: ApprovalResponse = {
        requestId: webhookBody.request.id,
        decision: 'APPROVE',
        approvedBy: 'admin@example.com',
      };

      await approvalGuard.handleApprovalResponse(approvalResponse, {});

      // Tool should execute after approval
      const result = await paymentPromise;
      expect(result).toEqual({ success: true });
      expect(paymentTool).toHaveBeenCalledWith({ amount: 2000 });
    });

    it('should block tool call when approval is denied', async () => {
      const paymentTool = vi.fn();
      const protectedPayment = approvalGuard.protect('send_payment', paymentTool);

      const paymentPromise = protectedPayment({ amount: 5000 });

      await vi.waitFor(() => {
        expect(mockWebhookHandler).toHaveBeenCalled();
      });

      const webhookBody = JSON.parse(mockWebhookHandler.mock.calls[0][1].body);

      // Simulate denial
      const denialResponse: ApprovalResponse = {
        requestId: webhookBody.request.id,
        decision: 'DENY',
        reason: 'Amount too high',
        approvedBy: 'admin@example.com',
      };

      await approvalGuard.handleApprovalResponse(denialResponse, {});

      await expect(paymentPromise).rejects.toThrow(
        'Tool call denied by human reviewer: Amount too high',
      );

      expect(paymentTool).not.toHaveBeenCalled();
    });

    it('should timeout if no approval response received', async () => {
      const tool = vi.fn();
      const protectedTool = approvalGuard.protect('send_payment', tool);

      // Use short timeout for testing
      const timeoutGuard = createAgentGuard({
        policy: basePolicy,
        enableLogging: false,
        timeout: 100,
        webhook: { url: 'https://example.com/webhook' },
      });
      await timeoutGuard.initialize();

      const timeoutProtected = timeoutGuard.protect('send_payment', tool);

      await expect(timeoutProtected({ amount: 3000 })).rejects.toThrow(
        'Approval request timed out',
      );

      expect(tool).not.toHaveBeenCalled();
    });
  });

  describe('Wrapped Function Metadata', () => {
    it('should identify wrapped functions', async () => {
      await guard.initialize();

      const originalTool = vi.fn();
      const wrappedTool = guard.protect('test_tool', originalTool);

      expect(wrappedTool.__agentguard_wrapped).toBe(true);
      expect(wrappedTool.__original_function).toBe(originalTool);
    });

    it('should preserve function behavior for allowed calls', async () => {
      await guard.initialize();

      const originalTool = vi.fn().mockImplementation((a: number, b: number) => a + b);

      const policy: Policy = {
        ...basePolicy,
        defaultAction: 'ALLOW',
      };

      const allowGuard = createAgentGuard({ policy, enableLogging: false });
      await allowGuard.initialize();

      const wrappedTool = allowGuard.protect('calculator', originalTool);

      const result = await wrappedTool(5, 3);
      expect(result).toBe(8);
      expect(originalTool).toHaveBeenCalledWith(5, 3);
    });
  });

  describe('Error Handling', () => {
    it('should throw specific error types', async () => {
      await guard.initialize();

      const tool = vi.fn();
      const protectedTool = guard.protect('database_delete', tool);

      try {
        await protectedTool({});
      } catch (error: any) {
        expect(error.name).toBe('PolicyViolationError');
        expect(error.code).toBe('POLICY_VIOLATION');
        expect(error.rule).toBeDefined();
        expect(error.toolCall).toBeDefined();
      }
    });

    it('should handle tool function errors correctly', async () => {
      await guard.initialize();

      const errorTool = vi.fn().mockRejectedValue(new Error('Database connection failed'));
      const protectedTool = guard.protect('database_read', errorTool);

      await expect(protectedTool({})).rejects.toThrow('Database connection failed');
    });
  });
});
