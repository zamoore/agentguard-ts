import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentGuard } from '../../src/index.js';
import { createMockPolicy } from '../helpers/index.js';

describe('Webhook Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send webhook with correct headers', async () => {
    let capturedRequest: any;
    global.fetch = vi.fn(async (url, options) => {
      capturedRequest = { url, options };
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;

    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: {
        url: 'https://api.example.com/approval',
        headers: {
          Authorization: 'Bearer secret-token',
          'X-API-Key': 'api-key-123',
          'X-Custom-Header': 'custom-value',
        },
      },
    });

    const guard = new AgentGuard({ policy, enableLogging: false, timeout: 100 });
    await guard.initialize();

    const tool = guard.protect('test', () => 'result');

    try {
      await tool();
    } catch (error) {
      // Expected timeout
    }

    expect(capturedRequest.options.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'X-API-Key': 'api-key-123',
      'X-Custom-Header': 'custom-value',
      'Content-Type': 'application/json',
      'User-Agent': 'AgentGuard/1.0',
    });
  });

  it('should handle webhook timeout', async () => {
    global.fetch = vi.fn(async (url, options) => {
      // Simulate the timeout behavior by checking if AbortSignal is provided
      const signal = options?.signal as AbortSignal;
      if (signal) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('This operation was aborted'));
          });
          // Never resolve to simulate a hanging request
        });
      }
      return new Promise(() => {}); // Never resolves
    }) as any;

    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: {
        url: 'https://slow.example.com/webhook',
        timeout: 100,
      },
    });

    const guard = new AgentGuard({ policy, enableLogging: false, timeout: 500 });
    await guard.initialize();

    const tool = guard.protect('test', () => 'result');

    await expect(tool()).rejects.toThrow('Failed to send approval request webhook');
  });

  it('should retry webhook on failure', async () => {
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`Attempt ${attempts} failed`);
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;

    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: {
        url: 'https://example.com/webhook',
        retries: 3,
        timeout: 1000,
      },
    });

    const guard = new AgentGuard({ policy, enableLogging: false, timeout: 100 });
    await guard.initialize();

    const tool = guard.protect('test', () => 'result');

    try {
      await tool();
    } catch (error) {
      // Expected timeout
    }

    expect(attempts).toBe(3);
  });

  it('should handle webhook HTTP errors', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Server error' }), {
          status: 500,
          statusText: 'Internal Server Error',
        }),
    ) as any;

    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: {
        url: 'https://example.com/webhook',
        retries: 1,
      },
    });

    const guard = new AgentGuard({ policy, enableLogging: false, timeout: 100 });
    await guard.initialize();

    const tool = guard.protect('test', () => 'result');

    await expect(tool()).rejects.toThrow();
  });

  it('should include tool call details in webhook payload', async () => {
    let webhookPayload: any;
    global.fetch = vi.fn(async (url, options) => {
      webhookPayload = JSON.parse(options?.body as string);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;

    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: { url: 'https://example.com/webhook' },
    });

    const guard = new AgentGuard({ policy, enableLogging: false, timeout: 100 });
    await guard.initialize();

    const tool = guard.protect(
      'sensitiveOperation',
      (params: { action: string; target: string }) => 'result',
      {
        agentId: 'agent-123',
        sessionId: 'session-456',
        metadata: { user: 'john@example.com', ip: '192.168.1.1' },
      },
    );

    try {
      await tool({ action: 'delete', target: 'production-db' });
    } catch (error) {
      // Expected timeout
    }

    expect(webhookPayload).toMatchObject({
      type: 'approval_request',
      request: {
        id: expect.any(String),
        toolCall: {
          toolName: 'sensitiveOperation',
          parameters: { action: 'delete', target: 'production-db' },
          agentId: 'agent-123',
          sessionId: 'session-456',
          metadata: { user: 'john@example.com', ip: '192.168.1.1' },
        },
        timestamp: expect.any(String),
        expiresAt: expect.any(String),
      },
      timestamp: expect.any(String),
    });
  });
});
