import { createHmac, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

import type { WebhookSecurityConfig } from '../types.js';

export class WebhookSecurity {
  private readonly algorithm = 'aes-256-gcm';
  private readonly signatureHeader = 'x-agentguard-signature';
  private readonly timestampHeader = 'x-agentguard-timestamp';
  private readonly nonceHeader = 'x-agentguard-nonce';

  constructor(private readonly config: WebhookSecurityConfig) {
    if (!config.signingSecret || config.signingSecret.length < 32) {
      throw new Error('Webhook signing secret must be at least 32 characters');
    }
  }

  /**
   * Sign a webhook payload
   */
  signPayload(payload: string, timestamp: number, nonce: string): string {
    const message = `${timestamp}.${nonce}.${payload}`;
    return createHmac('sha256', this.config.signingSecret).update(message).digest('hex');
  }

  /**
   * Verify a webhook signature
   */
  verifySignature(payload: string, signature: string, timestamp: number, nonce: string): boolean {
    // Check timestamp to prevent replay attacks (5 minute window)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return false;
    }

    const expectedSignature = this.signPayload(payload, timestamp, nonce);

    // Constant-time comparison to prevent timing attacks
    return this.secureCompare(signature, expectedSignature);
  }

  /**
   * Encrypt sensitive payload data
   */
  encryptPayload(payload: object): { encrypted: string; iv: string; tag: string } {
    if (!this.config.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const iv = randomBytes(16);
    const cipher = createCipheriv(
      this.algorithm,
      Buffer.from(this.config.encryptionKey, 'hex'),
      iv,
    );

    const jsonPayload = JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(jsonPayload, 'utf8'), cipher.final()]);

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  /**
   * Decrypt payload data
   */
  decryptPayload(encryptedData: { encrypted: string; iv: string; tag: string }): object {
    if (!this.config.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const decipher = createDecipheriv(
      this.algorithm,
      Buffer.from(this.config.encryptionKey, 'hex'),
      Buffer.from(encryptedData.iv, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(encryptedData.tag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedData.encrypted, 'base64')),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Generate secure headers for a webhook request
   */
  generateHeaders(payload: string): Record<string, string> {
    const timestamp = Date.now();
    const nonce = randomBytes(16).toString('hex');
    const signature = this.signPayload(payload, timestamp, nonce);

    return {
      [this.signatureHeader]: signature,
      [this.timestampHeader]: timestamp.toString(),
      [this.nonceHeader]: nonce,
      'Content-Type': 'application/json',
      'User-Agent': 'AgentGuard/1.0',
    };
  }

  /**
   * Validate incoming webhook response
   */
  validateResponse(
    body: string,
    headers: Record<string, string>,
  ): { valid: boolean; reason?: string } {
    const signature = headers[this.signatureHeader];
    const timestamp = headers[this.timestampHeader];
    const nonce = headers[this.nonceHeader];

    if (!signature || !timestamp || !nonce) {
      return {
        valid: false,
        reason: 'Missing required security headers',
      };
    }

    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum)) {
      return {
        valid: false,
        reason: 'Invalid timestamp format',
      };
    }

    const isValid = this.verifySignature(body, signature, timestampNum, nonce);

    return {
      valid: isValid,
      ...(!isValid && { reason: 'Invalid signature' }),
    };
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
