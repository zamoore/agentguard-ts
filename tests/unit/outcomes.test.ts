import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentGuard } from '../../src/lib/agentguard.js';
import { PolicyViolationError } from '../../src/lib/errors.js';
import { createMockPolicy } from '../helpers/index.js';
import { mockTools } from '../fixtures/tools.js';
import type { Policy } from '../../src/types.js';

describe('Outcomes Unit Tests', () => {
  let guard: AgentGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  describe('ALLOW Outcome', () => {
    it('should allow tool execution when default action is ALLOW', async () => {
      const policy = createMockPolicy({ defaultAction: 'ALLOW' });
      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);
      const result = await wrapped(10, 20);

      expect(result).toBe(30);
    });

    it('should allow execution when rule matches with ALLOW action', async () => {
      const policy = createMockPolicy({
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'allow-read',
            action: 'ALLOW',
            conditions: [
              {
                field: 'toolCall.toolName',
                operator: 'equals',
                value: 'databaseRead',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('databaseRead', mockTools.databaseRead);
      const result = await wrapped({ table: 'users' });

      expect(result).toEqual({ rows: [], table: 'users' });
    });

    it('should prioritize higher priority ALLOW rules', async () => {
      const policy = createMockPolicy({
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'low-priority-block',
            priority: 10,
            action: 'BLOCK',
            conditions: [{ field: 'toolCall.toolName', operator: 'equals', value: 'test' }],
          },
          {
            name: 'high-priority-allow',
            priority: 100,
            action: 'ALLOW',
            conditions: [{ field: 'toolCall.toolName', operator: 'equals', value: 'test' }],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);
      const result = await wrapped(1, 1);

      expect(result).toBe(2); // Should be allowed due to higher priority rule
    });
  });

  describe('BLOCK Outcome', () => {
    it('should block tool execution when default action is BLOCK', async () => {
      const policy = createMockPolicy({ defaultAction: 'BLOCK' });
      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      await expect(wrapped(1, 2)).rejects.toThrow(PolicyViolationError);
      await expect(wrapped(1, 2)).rejects.toThrow('No matching rules found, using default action');
    });

    it('should block execution when rule matches with BLOCK action', async () => {
      const policy = createMockPolicy({
        defaultAction: 'ALLOW',
        rules: [
          {
            name: 'block-delete',
            action: 'BLOCK',
            conditions: [
              {
                field: 'toolCall.toolName',
                operator: 'contains',
                value: 'delete',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('databaseDelete', mockTools.databaseDelete);

      await expect(wrapped({ table: 'users', id: '123' })).rejects.toThrow(PolicyViolationError);
      await expect(wrapped({ table: 'users', id: '123' })).rejects.toThrow(
        'Matched rule: block-delete',
      );
    });

    it('should include rule information in PolicyViolationError', async () => {
      const policy = createMockPolicy({
        defaultAction: 'ALLOW',
        rules: [
          {
            name: 'test-block-rule',
            description: 'Blocks test operations',
            action: 'BLOCK',
            conditions: [
              {
                field: 'toolCall.toolName',
                operator: 'equals',
                value: 'blocked-tool',
              },
            ],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('blocked-tool', mockTools.simpleFunction);

      try {
        await wrapped(1, 2);
        expect.fail('Should have thrown PolicyViolationError');
      } catch (error) {
        expect(error).toBeInstanceOf(PolicyViolationError);
        const policyError = error as PolicyViolationError;
        expect(policyError.rule.name).toBe('test-block-rule');
        expect(policyError.toolCall.toolName).toBe('blocked-tool');
      }
    });
  });

  describe('REQUIRE_HUMAN_APPROVAL Outcome', () => {
    it('should trigger approval workflow when default action is REQUIRE_HUMAN_APPROVAL', async () => {
      const policy = createMockPolicy({
        defaultAction: 'REQUIRE_HUMAN_APPROVAL',
        webhook: {
          url: 'https://example.com/webhook',
          timeout: 5000,
        },
      });

      guard = new AgentGuard({ policy, enableLogging: false, timeout: 100 });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      // Should timeout since no approval is provided
      await expect(wrapped(1, 2)).rejects.toThrow('Approval request timed out');
    });

    it('should allow execution after approval', async () => {
      const policy = createMockPolicy({
        defaultAction: 'REQUIRE_HUMAN_APPROVAL',
        webhook: {
          url: 'https://example.com/webhook',
        },
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      // Simulate approval in background
      const resultPromise = wrapped(5, 7);

      // Wait a bit and approve
      setTimeout(async () => {
        await guard.handleApprovalResponse({
          requestId: expect.any(String) as any,
          decision: 'APPROVE',
          approvedBy: 'test-user',
        });
      }, 50);

      const result = await resultPromise;
      expect(result).toBe(12);
    });

    it('should block execution after denial', async () => {
      const policy = createMockPolicy({
        defaultAction: 'ALLOW',
        rules: [
          {
            name: 'require-approval',
            action: 'REQUIRE_HUMAN_APPROVAL',
            conditions: [
              {
                field: 'toolCall.parameters.amount',
                operator: 'gt',
                value: 1000,
              },
            ],
          },
        ],
        webhook: {
          url: 'https://example.com/webhook',
        },
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('financialTransaction', mockTools.financialTransaction);

      // Start the call
      const resultPromise = wrapped({
        amount: 5000,
        recipient: 'test',
        category: 'payment',
      });

      // Deny after a short delay
      setTimeout(async () => {
        await guard.handleApprovalResponse({
          requestId: expect.any(String) as any,
          decision: 'DENY',
          reason: 'Amount too high',
          approvedBy: 'reviewer',
        });
      }, 50);

      await expect(resultPromise).rejects.toThrow(PolicyViolationError);
      await expect(resultPromise).rejects.toThrow(
        'Tool call denied by human reviewer: Amount too high',
      );
    });

    it('should send webhook notification for approval requests', async () => {
      const policy = createMockPolicy({
        defaultAction: 'REQUIRE_HUMAN_APPROVAL',
        webhook: {
          url: 'https://example.com/webhook',
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      });

      guard = new AgentGuard({ policy, enableLogging: false, timeout: 100 });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      try {
        await wrapped(1, 2);
      } catch (error) {
        // Expected timeout
      }

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
          body: expect.stringContaining('"type":"approval_request"'),
        }),
      );
    });
  });

  describe('Rule Evaluation Order', () => {
    it('should evaluate rules in priority order', async () => {
      const policy = createMockPolicy({
        defaultAction: 'ALLOW',
        rules: [
          {
            name: 'rule-1',
            priority: 50,
            action: 'ALLOW',
            conditions: [{ field: 'toolCall.toolName', operator: 'equals', value: 'test' }],
          },
          {
            name: 'rule-2',
            priority: 100,
            action: 'BLOCK',
            conditions: [{ field: 'toolCall.toolName', operator: 'equals', value: 'test' }],
          },
          {
            name: 'rule-3',
            priority: 75,
            action: 'REQUIRE_HUMAN_APPROVAL',
            conditions: [{ field: 'toolCall.toolName', operator: 'equals', value: 'test' }],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      // Should match rule-2 (priority 100) first and block
      await expect(wrapped(1, 2)).rejects.toThrow('Matched rule: rule-2');
    });

    it('should handle rules with no priority (defaults to 0)', async () => {
      const policy = createMockPolicy({
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'no-priority',
            action: 'ALLOW',
            conditions: [{ field: 'toolCall.toolName', operator: 'equals', value: 'test' }],
          },
          {
            name: 'with-priority',
            priority: 1,
            action: 'BLOCK',
            conditions: [{ field: 'toolCall.toolName', operator: 'equals', value: 'test' }],
          },
        ],
      });

      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const wrapped = guard.protect('test', mockTools.simpleFunction);

      // Should match with-priority (priority 1) over no-priority (priority 0)
      await expect(wrapped(1, 2)).rejects.toThrow('Matched rule: with-priority');
    });
  });
});
