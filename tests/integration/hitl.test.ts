import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentGuard } from '../../src/lib/agentguard.js';
import { createMockPolicy, createMockApprovalResponse, delay } from '../helpers/index.js';
import { mockTools } from '../fixtures/tools.js';

describe('HITL Integration Tests', () => {
  let webhookCalls: any[] = [];

  beforeEach(() => {
    webhookCalls = [];
    global.fetch = vi.fn(async (url, options) => {
      webhookCalls.push({ url, options: JSON.parse(options?.body as string) });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should complete full approval workflow', async () => {
    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: { url: 'https://example.com/webhook' },
    });

    const guard = new AgentGuard({ policy, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('financialTransaction', mockTools.financialTransaction);

    // Start transaction
    const transactionPromise = tool({
      amount: 5000,
      recipient: 'vendor@example.com',
      category: 'financial',
    });

    // Wait for webhook
    await delay(50);
    expect(webhookCalls).toHaveLength(1);
    const webhookData = webhookCalls[0].options;
    const requestId = webhookData.request.id;

    // Simulate approval
    await guard.handleApprovalResponse({
      requestId,
      decision: 'APPROVE',
      approvedBy: 'manager@company.com',
      reason: 'Valid business expense',
    });

    const result = await transactionPromise;
    expect(result).toEqual({
      transactionId: 'tx-123',
      amount: 5000,
      recipient: 'vendor@example.com',
      category: 'financial',
    });
  });

  it('should handle approval timeout', async () => {
    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: { url: 'https://example.com/webhook' },
    });

    const guard = new AgentGuard({
      policy,
      enableLogging: false,
      timeout: 100, // Very short timeout
    });
    await guard.initialize();

    const tool = guard.protect('test', mockTools.simpleFunction);

    await expect(tool(1, 2)).rejects.toThrow('Approval request timed out');
  });

  it('should handle concurrent approval requests', async () => {
    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: { url: 'https://example.com/webhook' },
    });

    const guard = new AgentGuard({ policy, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('test', mockTools.asyncFunction);

    // Start multiple requests
    const promises = [
      tool({ message: 'request1' }),
      tool({ message: 'request2' }),
      tool({ message: 'request3' }),
    ];

    // Wait for webhooks
    await delay(50);
    expect(webhookCalls).toHaveLength(3);

    // Approve all requests
    for (const call of webhookCalls) {
      await guard.handleApprovalResponse({
        requestId: call.options.request.id,
        decision: 'APPROVE',
        approvedBy: 'approver',
      });
    }

    const results = await Promise.all(promises);
    expect(results).toEqual([
      { success: true, echo: 'request1' },
      { success: true, echo: 'request2' },
      { success: true, echo: 'request3' },
    ]);
  });

  it('should handle webhook retry on failure', async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Network error');
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;

    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: {
        url: 'https://example.com/webhook',
        retries: 3,
      },
    });

    const guard = new AgentGuard({ policy, enableLogging: false, timeout: 200 });
    await guard.initialize();

    const tool = guard.protect('test', mockTools.simpleFunction);

    // Should eventually timeout, but webhook should retry
    try {
      await tool(1, 2);
    } catch (error) {
      // Expected timeout
    }

    expect(callCount).toBe(3); // Should have retried
  });
});
