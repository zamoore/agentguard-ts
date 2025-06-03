import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentGuard } from '../../src/lib/agentguard.js';
import { Logger } from '../../src/lib/logger.js';
import { HITLManager } from '../../src/lib/hitl-manager.js';
import { createMockPolicy, createMockToolCall } from '../helpers/index.js';
import type { PolicyCondition, PolicyEvaluationContext } from '../../src/types.js';

describe('Utils Unit Tests', () => {
  describe('Condition Operators', () => {
    let guard: AgentGuard;
    let context: PolicyEvaluationContext;

    beforeEach(async () => {
      const policy = createMockPolicy({ defaultAction: 'ALLOW' });
      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();

      context = {
        toolCall: createMockToolCall({
          toolName: 'testTool',
          parameters: {
            string: 'hello world',
            number: 42,
            array: ['a', 'b', 'c'],
            nested: {
              value: 'nested value',
              count: 10,
            },
          },
        }),
        policy,
        timestamp: new Date().toISOString(),
      };
    });

    describe('equals operator', () => {
      it('should match exact string values', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.toolName',
          operator: 'equals',
          value: 'testTool',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should match exact number values', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.number',
          operator: 'equals',
          value: 42,
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should not match different values', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.toolName',
          operator: 'equals',
          value: 'differentTool',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(false);
      });
    });

    describe('contains operator', () => {
      it('should match substring in string', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.string',
          operator: 'contains',
          value: 'world',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should return false for non-string values', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.number',
          operator: 'contains',
          value: '42',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(false);
      });
    });

    describe('startsWith operator', () => {
      it('should match string prefix', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.string',
          operator: 'startsWith',
          value: 'hello',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should not match non-prefix', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.string',
          operator: 'startsWith',
          value: 'world',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(false);
      });
    });

    describe('endsWith operator', () => {
      it('should match string suffix', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.string',
          operator: 'endsWith',
          value: 'world',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });
    });

    describe('regex operator', () => {
      it('should match regex pattern', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.string',
          operator: 'regex',
          value: '^hello.*world$',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should handle regex flags', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.string',
          operator: 'regex',
          value: 'HELLO',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(false); // Case sensitive by default
      });
    });

    describe('in operator', () => {
      it('should match value in array', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.toolName',
          operator: 'in',
          value: ['testTool', 'anotherTool'],
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should return false for non-array condition value', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.toolName',
          operator: 'in',
          value: 'not-an-array',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(false);
      });
    });

    describe('numeric operators', () => {
      it('should handle gt operator', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.number',
          operator: 'gt',
          value: 40,
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should handle lt operator', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.number',
          operator: 'lt',
          value: 50,
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should handle gte operator', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.number',
          operator: 'gte',
          value: 42,
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should handle lte operator', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.number',
          operator: 'lte',
          value: 42,
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should parse string numbers', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.number',
          operator: 'gt',
          value: '40',
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(true);
      });

      it('should return false for non-numeric values', () => {
        const condition: PolicyCondition = {
          field: 'toolCall.parameters.string',
          operator: 'gt',
          value: 10,
        };

        const result = (guard as any).evaluateCondition(condition, context);
        expect(result).toBe(false);
      });
    });
  });

  describe('Field Extraction', () => {
    let guard: AgentGuard;

    beforeEach(async () => {
      const policy = createMockPolicy({ defaultAction: 'ALLOW' });
      guard = new AgentGuard({ policy, enableLogging: false });
      await guard.initialize();
    });

    it('should extract nested fields using dot notation', () => {
      const context = {
        toolCall: {
          parameters: {
            deeply: {
              nested: {
                value: 'found it!',
              },
            },
          },
        },
      };

      const value = (guard as any).extractFieldValue(
        'toolCall.parameters.deeply.nested.value',
        context,
      );

      expect(value).toBe('found it!');
    });

    it('should return undefined for non-existent fields', () => {
      const context = {
        toolCall: {
          parameters: {},
        },
      };

      const value = (guard as any).extractFieldValue(
        'toolCall.parameters.nonexistent.field',
        context,
      );

      expect(value).toBeUndefined();
    });

    it('should handle array indices in field paths', () => {
      const context = {
        toolCall: {
          parameters: {
            items: [{ id: 1 }, { id: 2 }, { id: 3 }],
          },
        },
      };

      const value = (guard as any).extractFieldValue('toolCall.parameters.items.1.id', context);

      expect(value).toBe(2);
    });
  });

  describe('Logger', () => {
    it('should log messages when enabled', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new Logger({ enabled: true });

      logger.info('test message', { data: 123 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'INFO',
          message: 'test message',
          data: { data: 123 },
        }),
      );

      consoleSpy.mockRestore();
    });

    it('should not log when disabled', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new Logger({ enabled: false });

      logger.info('test message');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should respect log levels', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const logger = new Logger({ enabled: true, minLevel: 'info' });

      logger.debug('debug message');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use custom log handler', () => {
      const handler = vi.fn();
      const logger = new Logger({ enabled: true, handler });

      logger.error('error message', new Error('test error'));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'error message',
        }),
      );
    });
  });

  describe('HITL Manager', () => {
    let manager: HITLManager;

    beforeEach(() => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      manager = new HITLManager(
        { url: 'https://example.com/webhook' },
        new Logger({ enabled: false }),
      );
    });

    it('should create approval requests', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should track pending approvals', async () => {
      const toolCall = createMockToolCall();
      await manager.createApprovalRequest(toolCall);

      const pending = manager.getPendingApprovals();
      expect(pending).toHaveLength(1);
    });

    it('should clean up expired requests', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      // Manually expire the request
      const pending = (manager as any).pendingApprovals.get(requestId);
      pending.request.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const cleaned = manager.cleanupExpiredRequests();
      expect(cleaned).toBe(1);
      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it('should provide approval statistics', async () => {
      const stats = manager.getStats();
      expect(stats).toEqual({
        pendingCount: 0,
        oldestRequestAge: null,
        averageWaitTime: null,
      });

      await manager.createApprovalRequest(createMockToolCall());

      const newStats = manager.getStats();
      expect(newStats.pendingCount).toBe(1);
      expect(newStats.oldestRequestAge).toBeGreaterThan(0);
    });
  });
});
