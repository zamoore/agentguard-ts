import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentGuard } from '../../src/index.js';
import { WebhookSecurity } from '../../src/lib/webhook-security.js';
import { delay } from '../helpers/index.js';
import type { WebhookConfig, ApprovalResponse } from '../../src/types.js';

describe('Secure Webhook Flow Integration', () => {
  let guard: AgentGuard;
  let webhookRequests: any[] = [];
  let webhookSecurity: WebhookSecurity;

  const secureWebhookConfig: WebhookConfig = {
    url: 'https://example.com/webhook',
    security: {
      signingSecret: 'integration-test-secret-key-minimum-32-characters',
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      encryptSensitiveData: true,
      sensitiveFields: [
        'request.toolCall.parameters.password',
        'request.toolCall.parameters.apiKey',
      ] as const,
    },
  };

  beforeEach(() => {
    webhookRequests = [];
    global.fetch = vi.fn(async (url, options) => {
      webhookRequests.push({
        url,
        options: {
          ...options,
          body: options?.body as string,
        },
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;

    // Create webhook security instance for testing
    webhookSecurity = new WebhookSecurity(secureWebhookConfig.security!);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('webhook security headers', () => {
    it('should send webhook with security headers', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
        timeout: 100,
      });
      await guard.initialize();

      const tool = guard.protect('test-tool', () => 'result');

      // Start approval flow
      const toolPromise = tool();

      // Wait for webhook to be sent
      await delay(50);

      expect(webhookRequests).toHaveLength(1);
      const headers = webhookRequests[0].options.headers;

      expect(headers).toHaveProperty('x-agentguard-signature');
      expect(headers).toHaveProperty('x-agentguard-request-id');
      expect(headers).toHaveProperty('x-agentguard-timestamp');
      expect(headers).toHaveProperty('x-agentguard-nonce');
      expect(headers).toHaveProperty('Content-Type', 'application/json');
      expect(headers).toHaveProperty('User-Agent', 'AgentGuard/1.0');

      // Verify signature is valid
      const body = webhookRequests[0].options.body;
      const requestId = webhookRequests[0].options.headers['x-agentguard-request-id'];
      const timestamp = parseInt(headers['x-agentguard-timestamp'], 10);
      const isValid = webhookSecurity.verifySignature(
        body,
        headers['x-agentguard-signature'],
        requestId,
        timestamp,
        headers['x-agentguard-nonce'],
      );

      expect(isValid).toBe(true);

      // Let it timeout
      await expect(toolPromise).rejects.toThrow('Approval request timed out');
    });

    it('should work without security configuration', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: {
          url: 'https://example.com/webhook',
        },
        enableLogging: false,
        timeout: 100,
      });
      await guard.initialize();

      const tool = guard.protect('test-tool', () => 'result');
      const toolPromise = tool();

      await delay(50);

      expect(webhookRequests).toHaveLength(1);
      const headers = webhookRequests[0].options.headers;

      // Should not have security headers
      expect(headers).not.toHaveProperty('x-agentguard-signature');
      expect(headers).not.toHaveProperty('x-agentguard-timestamp');
      expect(headers).not.toHaveProperty('x-agentguard-nonce');

      await expect(toolPromise).rejects.toThrow('Approval request timed out');
    });
  });

  describe('sensitive field encryption', () => {
    it('should encrypt sensitive fields in webhook payload', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
        timeout: 100,
      });
      await guard.initialize();

      const tool = guard.protect('api-call', async (params: any) => {
        return { success: true, ...params };
      });

      const toolPromise = tool({
        action: 'create-user',
        apiKey: 'super-secret-api-key',
        endpoint: 'https://api.example.com/users',
        password: 'user-password-123',
      });

      await delay(50);

      const payload = JSON.parse(webhookRequests[0].options.body);

      // Check that sensitive fields are encrypted
      const apiKeyField = payload.request.toolCall.parameters.apiKey;
      expect(apiKeyField).toHaveProperty('encrypted');
      expect(apiKeyField).toHaveProperty('iv');
      expect(apiKeyField).toHaveProperty('tag');
      expect(typeof apiKeyField.encrypted).toBe('string');
      expect(typeof apiKeyField.iv).toBe('string');
      expect(typeof apiKeyField.tag).toBe('string');
      expect(JSON.stringify(apiKeyField)).not.toContain('super-secret-api-key');

      const passwordField = payload.request.toolCall.parameters.password;
      expect(passwordField).toHaveProperty('encrypted');
      expect(passwordField).toHaveProperty('iv');
      expect(passwordField).toHaveProperty('tag');
      expect(typeof passwordField.encrypted).toBe('string');
      expect(typeof passwordField.iv).toBe('string');
      expect(typeof passwordField.tag).toBe('string');
      expect(JSON.stringify(passwordField)).not.toContain('user-password-123');

      // Check that non-sensitive fields are not encrypted
      expect(payload.request.toolCall.parameters.action).toBe('create-user');
      expect(payload.request.toolCall.parameters.endpoint).toBe('https://api.example.com/users');

      // Verify we can decrypt the fields
      const decryptedApiKey = webhookSecurity.decryptPayload(apiKeyField);
      expect(decryptedApiKey).toEqual({ value: 'super-secret-api-key' });

      const decryptedPassword = webhookSecurity.decryptPayload(passwordField);
      expect(decryptedPassword).toEqual({ value: 'user-password-123' });

      await expect(toolPromise).rejects.toThrow('Approval request timed out');
    });

    it('should handle nested sensitive fields', async () => {
      const configWithNestedFields: WebhookConfig = {
        url: 'https://example.com/webhook',
        security: {
          signingSecret: 'integration-test-secret-key-minimum-32-characters',
          encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          encryptSensitiveData: true,
          sensitiveFields: ['request.toolCall.parameters.auth.token'] as const,
        },
      };

      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: configWithNestedFields,
        enableLogging: false,
        timeout: 100,
      });
      await guard.initialize();

      const tool = guard.protect('api-call', async (params: any) => params);

      const toolPromise = tool({
        method: 'POST',
        auth: {
          type: 'bearer',
          token: 'secret-bearer-token',
        },
      });

      await delay(50);

      const payload = JSON.parse(webhookRequests[0].options.body);

      // Check nested field is encrypted
      const tokenField = payload.request.toolCall.parameters.auth.token;
      expect(tokenField).toHaveProperty('encrypted');
      expect(tokenField).toHaveProperty('iv');
      expect(tokenField).toHaveProperty('tag');
      expect(typeof tokenField.encrypted).toBe('string');
      expect(typeof tokenField.iv).toBe('string');
      expect(typeof tokenField.tag).toBe('string');
      expect(JSON.stringify(tokenField)).not.toContain('secret-bearer-token');

      // Check parent object structure is preserved
      expect(payload.request.toolCall.parameters.auth.type).toBe('bearer');

      await expect(toolPromise).rejects.toThrow('Approval request timed out');
    });
  });

  describe('approval response validation', () => {
    it('should accept valid signed approval response', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
      });
      await guard.initialize();

      const tool = guard.protect('test-tool', () => ({ result: 'success' }));
      const toolPromise = tool();

      await delay(50);

      // Extract request ID from webhook
      const webhookPayload = JSON.parse(webhookRequests[0].options.body);
      const requestId = webhookPayload.request.id;

      // Create properly signed approval response
      const approvalResponse: ApprovalResponse = {
        requestId,
        decision: 'APPROVE',
        reason: 'Approved by test',
        approvedBy: 'test@example.com',
      };

      const responseBody = JSON.stringify(approvalResponse);
      const responseHeaders = webhookSecurity.generateHeaders(responseBody, requestId);

      await guard.handleApprovalResponse(approvalResponse, responseHeaders);

      const result = await toolPromise;
      expect(result).toEqual({ result: 'success' });
    });

    it('should reject approval response with invalid signature', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
      });
      await guard.initialize();

      const tool = guard.protect('test-tool', () => ({ result: 'success' }));
      const toolPromise = tool();

      await delay(50);

      const webhookPayload = JSON.parse(webhookRequests[0].options.body);
      const requestId = webhookPayload.request.id;

      const approvalResponse: ApprovalResponse = {
        requestId,
        decision: 'APPROVE',
        reason: 'Approved by test',
        approvedBy: 'test@example.com',
      };

      // Create headers with invalid signature
      const responseHeaders = {
        'x-agentguard-signature': 'invalid-signature',
        'x-agentguard-timestamp': Date.now().toString(),
        'x-agentguard-nonce': 'test-nonce',
        'x-agentguard-request-id': requestId,
      };

      await expect(guard.handleApprovalResponse(approvalResponse, responseHeaders)).rejects.toThrow(
        'Invalid approval response: Invalid signature',
      );

      // Tool should still be waiting
      await delay(50);
      expect(toolPromise).toBeTruthy();
    });

    it('should reject approval response with missing security headers', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
      });
      await guard.initialize();

      const tool = guard.protect('test-tool', () => ({ result: 'success' }));
      tool(); // Don't await, let it run

      await delay(50);

      const webhookPayload = JSON.parse(webhookRequests[0].options.body);
      const requestId = webhookPayload.request.id;

      const approvalResponse: ApprovalResponse = {
        requestId,
        decision: 'APPROVE',
        reason: 'Approved by test',
        approvedBy: 'test@example.com',
      };

      // Try to handle response without security headers
      await expect(guard.handleApprovalResponse(approvalResponse, {})).rejects.toThrow(
        'Invalid approval response: Missing required security headers',
      );
    });

    it('should prevent replay attacks with duplicate nonces', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
      });
      await guard.initialize();

      const tool = guard.protect('test-tool', () => ({ result: 'success' }));
      const toolPromise = tool();

      await delay(50);

      const webhookPayload = JSON.parse(webhookRequests[0].options.body);
      const requestId = webhookPayload.request.id;

      const approvalResponse: ApprovalResponse = {
        requestId,
        decision: 'APPROVE',
        reason: 'Approved by test',
        approvedBy: 'test@example.com',
      };

      const responseBody = JSON.stringify(approvalResponse);
      const responseHeaders = webhookSecurity.generateHeaders(responseBody, requestId);

      // First response should succeed
      await guard.handleApprovalResponse(approvalResponse, responseHeaders);

      // Wait for tool to complete
      await toolPromise;

      // Create another tool call
      const tool2 = guard.protect('test-tool-2', () => ({ result: 'success2' }));
      tool2(); // Start another approval

      await delay(50);

      // Try to replay with same nonce but different request
      const webhookPayload2 = JSON.parse(webhookRequests[1].options.body);
      const approvalResponse2: ApprovalResponse = {
        requestId: webhookPayload2.request.id,
        decision: 'APPROVE',
        reason: 'Replayed approval',
        approvedBy: 'attacker@example.com',
      };

      // Create new headers for the second response but reuse the nonce from first response
      const originalNonce = responseHeaders['x-agentguard-nonce'];
      const originalTimestamp = responseHeaders['x-agentguard-timestamp'];

      const secondResponseBody = JSON.stringify(approvalResponse2);

      // Generate a valid signature for the second body but with the reused nonce
      const replayedSignature = webhookSecurity.signPayload(
        secondResponseBody,
        webhookPayload2.request.id, // Use the correct request ID for the second request
        parseInt(originalTimestamp, 10),
        originalNonce,
      );

      const replayHeaders = {
        'x-agentguard-signature': replayedSignature,
        'x-agentguard-timestamp': originalTimestamp,
        'x-agentguard-nonce': originalNonce,
        'x-agentguard-request-id': webhookPayload2.request.id, // Add the required request ID header
      };

      // This should fail due to nonce reuse, not signature validation
      await expect(guard.handleApprovalResponse(approvalResponse2, replayHeaders)).rejects.toThrow(
        'Duplicate nonce detected - possible replay attack',
      );
    });
  });

  it('should prevent signature substitution attacks', async () => {
    guard = new AgentGuard({
      policy: {
        version: '1.0',
        name: 'Test Policy',
        defaultAction: 'REQUIRE_HUMAN_APPROVAL',
        rules: [],
      },
      webhook: secureWebhookConfig,
      enableLogging: false,
      timeout: 1000,
    });
    await guard.initialize();

    // Create two different tool calls
    const tool1 = guard.protect('low-risk-tool', () => ({ result: 'low-risk' }));
    const tool2 = guard.protect('high-risk-tool', () => ({ result: 'high-risk' }));

    // Start both approvals
    const promise1 = tool1();
    const promise2 = tool2();

    await delay(100);

    // Get both webhook requests
    const webhook1 = JSON.parse(webhookRequests[0].options.body);
    const webhook2 = JSON.parse(webhookRequests[1].options.body);

    // Create approval for request 1
    const approval1: ApprovalResponse = {
      requestId: webhook1.request.id,
      decision: 'APPROVE',
      reason: 'Low risk approved',
      approvedBy: 'admin@example.com',
    };

    const responseBody1 = JSON.stringify(approval1);
    const headers1 = webhookSecurity.generateHeaders(responseBody1, webhook1.request.id);

    // Try to use the signature from request 1 for request 2
    const fakeApproval2: ApprovalResponse = {
      requestId: webhook2.request.id,
      decision: 'APPROVE',
      reason: 'Fake approval',
      approvedBy: 'attacker@example.com',
    };

    const fakeHeaders2 = {
      ...headers1, // Reuse headers from request 1
      'x-agentguard-request-id': webhook2.request.id, // But change the request ID
    };

    // This should fail due to signature mismatch
    await expect(guard.handleApprovalResponse(fakeApproval2, fakeHeaders2)).rejects.toThrow(
      'Invalid approval response: Invalid signature',
    );

    // Properly approve request 1
    await guard.handleApprovalResponse(approval1, headers1);
    const result1 = await promise1;
    expect(result1).toEqual({ result: 'low-risk' });

    // Request 2 should still be pending and timeout
    await expect(promise2).rejects.toThrow('Approval request timed out');
  });

  describe('end-to-end secure workflow', () => {
    it('should complete full secure approval workflow', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
      });
      await guard.initialize();

      const tool = guard.protect('payment', async (params: any) => {
        return {
          transactionId: 'tx-12345',
          status: 'completed',
          ...params,
        };
      });

      const toolPromise = tool({
        amount: 1000,
        recipient: 'vendor@example.com',
        apiKey: 'payment-api-key-secret',
      });

      // Wait for webhook
      await delay(50);
      expect(webhookRequests).toHaveLength(1);

      // Verify webhook has security headers
      const webhookHeaders = webhookRequests[0].options.headers;
      expect(webhookHeaders).toHaveProperty('x-agentguard-signature');

      // Verify sensitive data is encrypted
      const webhookPayload = JSON.parse(webhookRequests[0].options.body);
      const apiKeyField = webhookPayload.request.toolCall.parameters.apiKey;
      expect(apiKeyField).toHaveProperty('encrypted');
      expect(apiKeyField).toHaveProperty('iv');
      expect(apiKeyField).toHaveProperty('tag');
      expect(typeof apiKeyField.encrypted).toBe('string');
      expect(typeof apiKeyField.iv).toBe('string');
      expect(typeof apiKeyField.tag).toBe('string');

      const { id: requestId } = webhookPayload.request;

      // Create signed approval
      const approvalResponse: ApprovalResponse = {
        requestId,
        decision: 'APPROVE',
        reason: 'Payment approved',
        approvedBy: 'finance@example.com',
      };

      const responseBody = JSON.stringify(approvalResponse);
      const responseHeaders = webhookSecurity.generateHeaders(responseBody, requestId);

      await guard.handleApprovalResponse(approvalResponse, responseHeaders);

      // Tool should complete successfully
      const result = await toolPromise;
      expect(result).toEqual({
        transactionId: 'tx-12345',
        status: 'completed',
        amount: 1000,
        recipient: 'vendor@example.com',
        apiKey: 'payment-api-key-secret',
      });
    });

    it('should handle secure denial workflow', async () => {
      guard = new AgentGuard({
        policy: {
          version: '1.0',
          name: 'Test Policy',
          defaultAction: 'REQUIRE_HUMAN_APPROVAL',
          rules: [],
        },
        webhook: secureWebhookConfig,
        enableLogging: false,
      });
      await guard.initialize();

      const tool = guard.protect('dangerous-operation', () => ({ result: 'should-not-happen' }));
      const toolPromise = tool();

      await delay(50);

      const webhookPayload = JSON.parse(webhookRequests[0].options.body);
      const { id: requestId } = webhookPayload.request;

      // Create signed denial
      const denialResponse: ApprovalResponse = {
        requestId,
        decision: 'DENY',
        reason: 'Operation too risky',
        approvedBy: 'security@example.com',
      };

      const responseBody = JSON.stringify(denialResponse);
      const responseHeaders = webhookSecurity.generateHeaders(responseBody, requestId);

      await guard.handleApprovalResponse(denialResponse, responseHeaders);

      await expect(toolPromise).rejects.toThrow(
        'Tool call denied by human reviewer: Operation too risky',
      );
    });
  });
});
