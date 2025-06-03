import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentGuard } from '../../../src/index.js';
import { createMockPolicy, delay } from '../../helpers/index.js';
import { mockTools } from '../../fixtures/tools.js';

describe('Approval Workflow Integration', () => {
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
    const requestId = webhookCalls[0].options.request.id;

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

  it('should handle denial', async () => {
    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: { url: 'https://example.com/webhook' },
    });

    const guard = new AgentGuard({ policy, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('test', mockTools.simpleFunction);
    const resultPromise = tool(1, 2);

    await delay(50);
    const requestId = webhookCalls[0].options.request.id;

    await guard.handleApprovalResponse({
      requestId,
      decision: 'DENY',
      reason: 'Not authorized',
      approvedBy: 'reviewer',
    });

    await expect(resultPromise).rejects.toThrow('Tool call denied by human reviewer');
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
    expect(results).toHaveLength(3);
  });
});
