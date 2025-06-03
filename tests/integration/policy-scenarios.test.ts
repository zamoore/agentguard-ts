import { describe, it, expect, vi } from 'vitest';
import { AgentGuard } from '../../src/index.js';
import { mockTools } from '../fixtures/tools.js';
import type { Policy } from '../../src/types.js';

describe('Policy Scenarios Integration', () => {
  describe('complex rule combinations', () => {
    it('should handle rule priority correctly', async () => {
      const policy: Policy = {
        version: '1.0',
        name: 'Priority Test',
        defaultAction: 'ALLOW',
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
            conditions: [
              { field: 'toolCall.toolName', operator: 'equals', value: 'test' },
              { field: 'toolCall.parameters.safe', operator: 'equals', value: true },
            ],
          },
        ],
      };

      const guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      // Create a function that accepts parameters with a 'safe' property
      const testFunction = (params: { safe: boolean }) => {
        return `Result with safe=${params.safe}`;
      };

      const tool = guard.protect('test', testFunction);

      // High priority rule matches - should allow
      expect(await tool({ safe: true })).toBe('Result with safe=true');

      // Only low priority rule matches - should block
      await expect(tool({ safe: false })).rejects.toThrow();
    });

    it('should handle nested parameter conditions', async () => {
      const policy: Policy = {
        version: '1.0',
        name: 'Nested Conditions',
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'nested-check',
            action: 'ALLOW',
            conditions: [
              { field: 'toolCall.parameters.user.role', operator: 'equals', value: 'admin' },
              { field: 'toolCall.parameters.user.verified', operator: 'equals', value: true },
              { field: 'toolCall.parameters.action.type', operator: 'in', value: ['read', 'list'] },
            ],
          },
        ],
      };

      const guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      // Create a mock function that accepts the nested parameters structure
      const nestedParamTool = async (params: {
        user: { role: string; verified: boolean };
        action: { type: string };
      }) => {
        return { success: true, params };
      };

      const tool = guard.protect('test', nestedParamTool);

      // All conditions met
      const result = await tool({
        user: { role: 'admin', verified: true },
        action: { type: 'read' },
      });
      expect(result.success).toBe(true);

      // Missing verified flag
      await expect(
        tool({
          user: { role: 'admin', verified: false },
          action: { type: 'read' },
        }),
      ).rejects.toThrow();
    });

    it('should handle regex patterns', async () => {
      const policy: Policy = {
        version: '1.0',
        name: 'Regex Patterns',
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'allow-safe-tools',
            action: 'ALLOW',
            conditions: [
              {
                field: 'toolCall.toolName',
                operator: 'regex',
                value: '^(read|get|list|fetch)_[a-z]+$',
              },
            ],
          },
          {
            name: 'block-admin-tools',
            priority: 100,
            action: 'BLOCK',
            conditions: [
              {
                field: 'toolCall.toolName',
                operator: 'regex',
                value: '_admin$',
              },
            ],
          },
        ],
      };

      const guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      const readTool = guard.protect('read_users', () => 'allowed');
      const adminTool = guard.protect('read_admin', () => 'blocked');
      const deleteTool = guard.protect('delete_users', () => 'blocked');

      expect(await readTool()).toBe('allowed');
      await expect(adminTool()).rejects.toThrow();
      await expect(deleteTool()).rejects.toThrow();
    });
  });

  describe('financial controls', () => {
    it('should implement tiered approval thresholds', async () => {
      // Mock fetch to succeed so the timeout actually occurs
      global.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      const policy: Policy = {
        version: '1.0',
        name: 'Financial Controls',
        defaultAction: 'BLOCK',
        webhook: { url: 'https://example.com/webhook' },
        rules: [
          {
            name: 'small-transactions',
            priority: 10,
            action: 'ALLOW',
            conditions: [
              { field: 'toolCall.toolName', operator: 'equals', value: 'transfer' },
              { field: 'toolCall.parameters.amount', operator: 'lte', value: 100 },
            ],
          },
          {
            name: 'medium-transactions',
            priority: 20,
            action: 'REQUIRE_HUMAN_APPROVAL',
            conditions: [
              { field: 'toolCall.toolName', operator: 'equals', value: 'transfer' },
              { field: 'toolCall.parameters.amount', operator: 'gt', value: 100 },
              { field: 'toolCall.parameters.amount', operator: 'lte', value: 10000 },
            ],
          },
          {
            name: 'large-transactions',
            priority: 30,
            action: 'BLOCK',
            conditions: [
              { field: 'toolCall.toolName', operator: 'equals', value: 'transfer' },
              { field: 'toolCall.parameters.amount', operator: 'gt', value: 10000 },
            ],
          },
        ],
      };

      const guard = new AgentGuard({ policy, enableLogging: false, timeout: 100 });
      await guard.initialize();

      const transfer = guard.protect('transfer', async (params: any) => ({
        success: true,
        ...params,
      }));

      // Small amount - allowed
      const small = await transfer({ amount: 50, to: 'user1' });
      expect(small.success).toBe(true);

      // Medium amount - requires approval (will timeout)
      await expect(transfer({ amount: 5000, to: 'user2' })).rejects.toThrow(
        'Approval request timed out',
      );

      // Large amount - blocked
      await expect(transfer({ amount: 50000, to: 'user3' })).rejects.toThrow(
        'Tool call blocked by policy',
      );
    });
  });

  describe('environment-based policies', () => {
    it('should enforce different rules per environment', async () => {
      const policy: Policy = {
        version: '1.0',
        name: 'Environment Policy',
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'dev-permissive',
            action: 'ALLOW',
            conditions: [
              { field: 'toolCall.metadata.environment', operator: 'equals', value: 'development' },
            ],
          },
          {
            name: 'staging-restricted',
            action: 'ALLOW',
            conditions: [
              { field: 'toolCall.metadata.environment', operator: 'equals', value: 'staging' },
              { field: 'toolCall.toolName', operator: 'in', value: ['read', 'list'] },
            ],
          },
          {
            name: 'production-strict',
            action: 'REQUIRE_HUMAN_APPROVAL',
            conditions: [
              { field: 'toolCall.metadata.environment', operator: 'equals', value: 'production' },
              { field: 'toolCall.toolName', operator: 'startsWith', value: 'write' },
            ],
          },
        ],
      };

      const guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      // Development - anything allowed
      const devTool = guard.protect('delete', () => 'ok', {
        metadata: { environment: 'development' },
      });
      expect(await devTool()).toBe('ok');

      // Staging - only reads allowed
      const stagingRead = guard.protect('read', () => 'data', {
        metadata: { environment: 'staging' },
      });
      const stagingWrite = guard.protect('write', () => 'fail', {
        metadata: { environment: 'staging' },
      });

      expect(await stagingRead()).toBe('data');
      await expect(stagingWrite()).rejects.toThrow();
    });
  });
});
