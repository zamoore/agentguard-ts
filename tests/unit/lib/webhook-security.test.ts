// tests/unit/lib/webhook-security.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookSecurity } from '../../../src/lib/webhook-security.js';
import type { WebhookSecurityConfig } from '../../../src/types.js';

describe('WebhookSecurity', () => {
  let security: WebhookSecurity;
  const validConfig: WebhookSecurityConfig = {
    signingSecret: 'test-secret-key-that-is-at-least-32-characters-long',
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    encryptSensitiveData: true,
    sensitiveFields: ['password', 'apiKey', 'request.toolCall.parameters.secret'] as const,
  };

  beforeEach(() => {
    security = new WebhookSecurity(validConfig);
  });

  describe('constructor', () => {
    it('should reject short signing secrets', () => {
      expect(
        () =>
          new WebhookSecurity({
            signingSecret: 'too-short',
          }),
      ).toThrow('Webhook signing secret must be at least 32 characters');
    });

    it('should accept valid configuration', () => {
      expect(() => new WebhookSecurity(validConfig)).not.toThrow();
    });
  });

  describe('signature generation and verification', () => {
    it('should generate consistent signatures', () => {
      const payload = JSON.stringify({ test: 'data' });
      const timestamp = Date.now();
      const nonce = 'test-nonce';

      const sig1 = security.signPayload(payload, timestamp, nonce);
      const sig2 = security.signPayload(payload, timestamp, nonce);

      expect(sig1).toBe(sig2);
    });

    it('should generate different signatures for different payloads', () => {
      const timestamp = Date.now();
      const nonce = 'test-nonce';

      const sig1 = security.signPayload('payload1', timestamp, nonce);
      const sig2 = security.signPayload('payload2', timestamp, nonce);

      expect(sig1).not.toBe(sig2);
    });

    it('should verify valid signatures', () => {
      const payload = JSON.stringify({ test: 'data' });
      const timestamp = Date.now();
      const nonce = 'test-nonce';

      const signature = security.signPayload(payload, timestamp, nonce);
      const isValid = security.verifySignature(payload, signature, timestamp, nonce);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const payload = JSON.stringify({ test: 'data' });
      const timestamp = Date.now();
      const nonce = 'test-nonce';

      const isValid = security.verifySignature(payload, 'invalid-signature', timestamp, nonce);

      expect(isValid).toBe(false);
    });

    it('should reject old timestamps (replay attack prevention)', () => {
      const payload = JSON.stringify({ test: 'data' });
      const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const nonce = 'test-nonce';

      const signature = security.signPayload(payload, oldTimestamp, nonce);
      const isValid = security.verifySignature(payload, signature, oldTimestamp, nonce);

      expect(isValid).toBe(false);
    });

    it('should accept recent timestamps', () => {
      const payload = JSON.stringify({ test: 'data' });
      const recentTimestamp = Date.now() - 2 * 60 * 1000; // 2 minutes ago
      const nonce = 'test-nonce';

      const signature = security.signPayload(payload, recentTimestamp, nonce);
      const isValid = security.verifySignature(payload, signature, recentTimestamp, nonce);

      expect(isValid).toBe(true);
    });
  });

  describe('encryption and decryption', () => {
    it('should encrypt and decrypt payload', () => {
      const originalPayload = {
        message: 'secret data',
        nested: { value: 42 },
      };

      const encrypted = security.encryptPayload(originalPayload);
      expect(encrypted).toHaveProperty('encrypted');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted.encrypted).not.toContain('secret data');

      const decrypted = security.decryptPayload(encrypted);
      expect(decrypted).toEqual(originalPayload);
    });

    it('should generate unique IVs for each encryption', () => {
      const payload = { message: 'test' };

      const encrypted1 = security.encryptPayload(payload);
      const encrypted2 = security.encryptPayload(payload);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
    });

    it('should throw when encryption key not configured', () => {
      const noEncryptionSecurity = new WebhookSecurity({
        signingSecret: 'test-secret-key-that-is-at-least-32-characters-long',
      });

      expect(() => noEncryptionSecurity.encryptPayload({ test: 'data' })).toThrow(
        'Encryption key not configured',
      );
    });

    it('should throw on decryption with wrong key', () => {
      const encrypted = security.encryptPayload({ secret: 'data' });

      const wrongKeySecurity = new WebhookSecurity({
        signingSecret: 'test-secret-key-that-is-at-least-32-characters-long',
        encryptionKey: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      });

      expect(() => wrongKeySecurity.decryptPayload(encrypted)).toThrow();
    });

    it('should throw on tampered encrypted data', () => {
      const encrypted = security.encryptPayload({ secret: 'data' });
      encrypted.tag = Buffer.from('tampered').toString('base64');

      expect(() => security.decryptPayload(encrypted)).toThrow();
    });
  });

  describe('header generation', () => {
    it('should generate required headers', () => {
      const payload = JSON.stringify({ test: 'data' });
      const headers = security.generateHeaders(payload);

      expect(headers).toHaveProperty('x-agentguard-signature');
      expect(headers).toHaveProperty('x-agentguard-timestamp');
      expect(headers).toHaveProperty('x-agentguard-nonce');
      expect(headers).toHaveProperty('Content-Type', 'application/json');
      expect(headers).toHaveProperty('User-Agent', 'AgentGuard/1.0');
    });

    it('should generate valid signature in headers', () => {
      const payload = JSON.stringify({ test: 'data' });
      const headers = security.generateHeaders(payload);

      const isValid = security.verifySignature(
        payload,
        headers['x-agentguard-signature'],
        parseInt(headers['x-agentguard-timestamp'], 10),
        headers['x-agentguard-nonce'],
      );

      expect(isValid).toBe(true);
    });
  });

  describe('response validation', () => {
    it('should validate valid response', () => {
      const body = JSON.stringify({ status: 'ok' });
      const headers = security.generateHeaders(body);

      const result = security.validateResponse(body, headers);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject response with missing headers', () => {
      const body = JSON.stringify({ status: 'ok' });
      const result = security.validateResponse(body, {});

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Missing required security headers');
    });

    it('should reject response with invalid signature', () => {
      const body = JSON.stringify({ status: 'ok' });
      const headers = {
        'x-agentguard-signature': 'invalid',
        'x-agentguard-timestamp': Date.now().toString(),
        'x-agentguard-nonce': 'test-nonce',
      };

      const result = security.validateResponse(body, headers);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid signature');
    });

    it('should reject response with invalid timestamp format', () => {
      const body = JSON.stringify({ status: 'ok' });
      const headers = {
        'x-agentguard-signature': 'some-signature',
        'x-agentguard-timestamp': 'not-a-number',
        'x-agentguard-nonce': 'test-nonce',
      };

      const result = security.validateResponse(body, headers);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid timestamp format');
    });
  });

  describe('secure comparison', () => {
    it('should use constant-time comparison', () => {
      // This is hard to test directly, but we can at least verify it works correctly
      const payload = 'test';
      const timestamp = Date.now();
      const nonce = 'nonce';
      const signature = security.signPayload(payload, timestamp, nonce);

      // Test with strings of different lengths (should still be secure)
      expect(security.verifySignature(payload, 'short', timestamp, nonce)).toBe(false);
      expect(security.verifySignature(payload, signature + 'extra', timestamp, nonce)).toBe(false);

      // Test with similar signatures
      const wrongSignature = signature.slice(0, -1) + 'X';
      expect(security.verifySignature(payload, wrongSignature, timestamp, nonce)).toBe(false);
    });
  });
});
