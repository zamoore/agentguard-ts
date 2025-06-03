import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentGuard } from '../../src/lib/agentguard.js';
import { createMockPolicy } from '../helpers/index.js';
import { AgentGuardError } from '../../src/lib/errors.js';

describe('API Integration Tests', () => {
  it('should expose public API correctly', () => {
    const guard = new AgentGuard({
      policy: createMockPolicy({ defaultAction: 'ALLOW' }),
    });

    expect(guard).toHaveProperty('initialize');
    expect(guard).toHaveProperty('protect');
    expect(guard).toHaveProperty('handleApprovalResponse');
    expect(guard).toHaveProperty('getPolicy');
    expect(guard).toHaveProperty('reloadPolicy');
  });

  it('should work with custom webhook headers', async () => {
    let capturedHeaders: any;
    global.fetch = vi.fn(async (url, options) => {
      capturedHeaders = options?.headers;
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

    expect(capturedHeaders).toMatchObject({
      Authorization: 'Bearer secret-token',
      'X-API-Key': 'api-key-123',
      'X-Custom-Header': 'custom-value',
      'Content-Type': 'application/json',
    });
  });

  it('should handle webhook timeouts', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any; // Never resolves

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

    await expect(tool()).rejects.toThrow(AgentGuardError);
  });

  it('should validate webhook URL format', async () => {
    const policy = createMockPolicy({
      defaultAction: 'REQUIRE_HUMAN_APPROVAL',
      webhook: {
        url: 'not-a-url',
      },
    });

    const guard = new AgentGuard({ policy, enableLogging: false });

    // Should fail during initialization due to invalid URL
    await expect(guard.initialize()).rejects.toThrow();
  });

  it('should handle approval response for unknown request', async () => {
    const guard = new AgentGuard({
      policy: createMockPolicy({ defaultAction: 'ALLOW' }),
    });
    await guard.initialize();

    await expect(
      guard.handleApprovalResponse({
        requestId: 'unknown-request-id',
        decision: 'APPROVE',
        approvedBy: 'user',
      }),
    ).rejects.toThrow('Unknown approval request ID');
  });
});
