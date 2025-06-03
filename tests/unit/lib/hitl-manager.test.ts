import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HITLManager } from '../../../src/lib/hitl-manager.js';
import { Logger } from '../../../src/lib/logger.js';
import { ApprovalTimeoutError, AgentGuardError } from '../../../src/lib/errors.js';
import { createMockToolCall, createMockApprovalResponse, delay } from '../../helpers/index.js';

describe('HITLManager', () => {
  let manager: HITLManager;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ enabled: false });
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  describe('createApprovalRequest()', () => {
    it('should create approval request and send webhook', async () => {
      manager = new HITLManager({ url: 'https://example.com/webhook' }, logger);

      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should handle webhook failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      manager = new HITLManager({ url: 'https://example.com/webhook' }, logger);

      const toolCall = createMockToolCall();

      await expect(manager.createApprovalRequest(toolCall)).rejects.toThrow(
        'Failed to send approval request webhook',
      );
    });

    it('should log warning when no webhook configured', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      manager = new HITLManager(null, logger);

      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      expect(requestId).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No webhook configured'),
        expect.any(Object),
      );
    });

    it('should cleanup pending request on webhook failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const manager = new HITLManager(
        { url: 'https://example.com/webhook' },
        new Logger({ enabled: false }),
      );
      const toolCall = createMockToolCall();

      await expect(manager.createApprovalRequest(toolCall)).rejects.toThrow(
        'Failed to send approval request webhook',
      );

      // Should not have any pending approvals after webhook failure
      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it('should handle early approval response before waitForApproval', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      const manager = new HITLManager(
        { url: 'https://example.com/webhook' },
        new Logger({ enabled: false }),
      );
      const toolCall = createMockToolCall();

      const requestId = await manager.createApprovalRequest(toolCall);

      // Simulate approval response arriving before waitForApproval is called
      const response = createMockApprovalResponse({ requestId, decision: 'APPROVE' });
      await manager.handleApprovalResponse(response);

      // The response should be queued, not processed yet
      expect(manager.getPendingApprovals()).toHaveLength(1);

      // Now call waitForApproval - it should resolve immediately with the queued response
      const startTime = Date.now();
      const result = await manager.waitForApproval(requestId, 5000);
      const elapsedTime = Date.now() - startTime;

      expect(result).toMatchObject({
        approved: true,
        reason: 'Test approval',
      });

      // Should resolve immediately (within 50ms), not wait for timeout
      expect(elapsedTime).toBeLessThan(50);

      // Pending approval should be cleaned up
      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it('should handle race condition edge case with multiple rapid responses', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      const logger = new Logger({ enabled: false });
      const warnSpy = vi.spyOn(logger, 'warn');
      const manager = new HITLManager({ url: 'https://example.com/webhook' }, logger);
      const toolCall = createMockToolCall();

      const requestId = await manager.createApprovalRequest(toolCall);

      // Send first response before waitForApproval
      const response1 = createMockApprovalResponse({
        requestId,
        decision: 'APPROVE',
        reason: 'First response',
      });
      await manager.handleApprovalResponse(response1);

      // Try to send second response (should warn about duplicate and overwrite)
      const response2 = createMockApprovalResponse({
        requestId,
        decision: 'DENY',
        reason: 'Second response',
      });
      await manager.handleApprovalResponse(response2);

      // Should have logged a warning about duplicate delivery
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate early response'));

      // waitForApproval should get the latest (second) response
      const result = await manager.waitForApproval(requestId, 5000);
      expect(result).toMatchObject({
        approved: false,
        reason: 'Second response',
      });
    });
  });

  describe('waitForApproval()', () => {
    beforeEach(() => {
      manager = new HITLManager({ url: 'https://example.com/webhook' }, logger);
    });

    it('should resolve when approval is received', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      const approvalPromise = manager.waitForApproval(requestId, 5000);

      // Simulate approval
      setTimeout(() => {
        manager.handleApprovalResponse({
          requestId,
          decision: 'APPROVE',
          reason: 'Looks good',
          approvedBy: 'reviewer',
        });
      }, 50);

      const result = await approvalPromise;
      expect(result).toEqual({
        approved: true,
        reason: 'Looks good',
        approvedBy: 'reviewer',
        responseTime: expect.any(Number),
      });
    });

    it('should resolve with denial', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      const approvalPromise = manager.waitForApproval(requestId, 5000);

      setTimeout(() => {
        manager.handleApprovalResponse({
          requestId,
          decision: 'DENY',
          reason: 'Too risky',
          approvedBy: 'reviewer',
        });
      }, 50);

      const result = await approvalPromise;
      expect(result).toEqual({
        approved: false,
        reason: 'Too risky',
        approvedBy: 'reviewer',
        responseTime: expect.any(Number),
      });
    });

    it('should timeout if no response', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      await expect(manager.waitForApproval(requestId, 100)).rejects.toThrow(ApprovalTimeoutError);
    });
  });

  describe('handleApprovalResponse()', () => {
    beforeEach(() => {
      manager = new HITLManager({ url: 'https://example.com/webhook' }, logger);
    });

    it('should handle response for unknown request', async () => {
      await expect(
        manager.handleApprovalResponse({
          requestId: 'unknown-id',
          decision: 'APPROVE',
          approvedBy: 'user',
        }),
      ).rejects.toThrow('Unknown approval request ID');
    });

    it('should measure response time', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      const approvalPromise = manager.waitForApproval(requestId, 5000);

      await delay(100);

      await manager.handleApprovalResponse({
        requestId,
        decision: 'APPROVE',
        approvedBy: 'user',
      });

      const result = await approvalPromise;
      expect(result.responseTime).toBeGreaterThanOrEqual(100);
    });
  });

  describe('webhook retries', () => {
    it('should retry on failure', async () => {
      let callCount = 0;
      global.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Network error');
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      manager = new HITLManager(
        {
          url: 'https://example.com/webhook',
          retries: 3,
        },
        logger,
      );

      const toolCall = createMockToolCall();
      await manager.createApprovalRequest(toolCall);

      expect(callCount).toBe(3);
    });

    it('should respect retry limit', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Always fails'));

      manager = new HITLManager(
        {
          url: 'https://example.com/webhook',
          retries: 2,
        },
        logger,
      );

      const toolCall = createMockToolCall();

      await expect(manager.createApprovalRequest(toolCall)).rejects.toThrow();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('utility methods', () => {
    beforeEach(() => {
      manager = new HITLManager({ url: 'https://example.com/webhook' }, logger);
    });

    it('should get pending approvals', async () => {
      const toolCall1 = createMockToolCall({ toolName: 'tool1' });
      const toolCall2 = createMockToolCall({ toolName: 'tool2' });

      await manager.createApprovalRequest(toolCall1);
      await manager.createApprovalRequest(toolCall2);

      const pending = manager.getPendingApprovals();
      expect(pending).toHaveLength(2);
    });

    it('should cancel approval', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      const approvalPromise = manager.waitForApproval(requestId, 5000);
      const cancelled = manager.cancelApproval(requestId, 'Test cancel');

      expect(cancelled).toBe(true);
      await expect(approvalPromise).rejects.toThrow('Approval request cancelled');
    });

    it('should cleanup expired requests', async () => {
      const toolCall = createMockToolCall();
      const requestId = await manager.createApprovalRequest(toolCall);

      // Manually expire the request by setting expiresAt to the past
      const pending = (manager as any).pendingApprovals.get(requestId);
      pending.request.expiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

      const cleaned = manager.cleanupExpiredRequests();
      expect(cleaned).toBe(1);
      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it('should provide statistics', async () => {
      const stats1 = manager.getStats();
      expect(stats1).toEqual({
        pendingCount: 0,
        oldestRequestAge: null,
        averageWaitTime: null,
      });

      await manager.createApprovalRequest(createMockToolCall());
      await delay(50);
      await manager.createApprovalRequest(createMockToolCall());

      const stats2 = manager.getStats();
      expect(stats2.pendingCount).toBe(2);
      expect(stats2.oldestRequestAge).toBeGreaterThanOrEqual(50);
      expect(stats2.oldestRequestAge).not.toBeNull();
      expect(stats2.averageWaitTime).toBeLessThan(stats2.oldestRequestAge!);
    });
  });
});
