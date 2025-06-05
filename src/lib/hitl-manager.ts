import { randomUUID } from 'crypto';
import { WebhookSecurity } from './webhook-security.js';

import type {
  ToolCall,
  ApprovalRequest,
  ApprovalResponse,
  WebhookConfig,
  HITLWorkflowResult,
} from '../types.js';

import { ApprovalTimeoutError, AgentGuardError } from './errors.js';
import type { Logger } from './logger.js';

export class HITLManager {
  private webhookSecurity?: WebhookSecurity;
  private readonly processedNonces = new Map<string, number>();
  private nonceCleanupInterval?: NodeJS.Timeout;

  private readonly pendingApprovals = new Map<
    string,
    {
      request: ApprovalRequest;
      resolve: (result: HITLWorkflowResult) => void;
      reject: (error: Error) => void;
      timeoutId: NodeJS.Timeout;
      // Store early response if it arrives before waitForApproval
      earlyResponse?: HITLWorkflowResult;
      // Track if waitForApproval has been called
      waitingForApproval: boolean;
    }
  >();

  constructor(
    private readonly webhookConfig: WebhookConfig | null,
    private readonly logger: Logger,
  ) {
    // Initialize webhook security if configured
    if (webhookConfig?.security) {
      this.webhookSecurity = new WebhookSecurity(webhookConfig.security);
      // Cleanup nonces every 10 minutes
      this.nonceCleanupInterval = setInterval(() => this.cleanupNonces(), 10 * 60 * 1000);
    }
  }

  /**
   * Create an approval request and send it via webhook
   */
  async createApprovalRequest(toolCall: ToolCall): Promise<string> {
    const requestId = randomUUID();
    const request: ApprovalRequest = {
      id: requestId,
      toolCall,
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
    };

    // Initialize the pending approval with proper placeholder handlers
    this.pendingApprovals.set(requestId, {
      request,
      resolve: () => {
        this.logger.warn(`Resolve called before waitForApproval for request ${requestId}`);
      },
      reject: () => {
        this.logger.warn(`Reject called before waitForApproval for request ${requestId}`);
      },
      timeoutId: null as any, // Will be set by waitForApproval
      waitingForApproval: false,
    });

    this.logger.info(`Created approval request: ${requestId}`, { request });

    // Send webhook if configured
    if (this.webhookConfig) {
      try {
        await this.sendWebhook(request);
        this.logger.info(`Webhook sent for approval request: ${requestId}`);
      } catch (error) {
        // Clean up the pending request on webhook failure
        this.pendingApprovals.delete(requestId);
        this.logger.error(`Failed to send webhook for approval request: ${requestId}`, error);
        throw new AgentGuardError(
          `Failed to send approval request webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'WEBHOOK_FAILED',
        );
      }
    } else {
      this.logger.warn(
        `No webhook configured, approval request ${requestId} created but not sent`,
        { request },
      );
    }

    return requestId;
  }

  /**
   * Wait for approval response with timeout
   */
  async waitForApproval(requestId: string, timeout: number): Promise<HITLWorkflowResult> {
    const startTime = Date.now();

    return new Promise<HITLWorkflowResult>((resolve, reject) => {
      // Check if we already have this request (from createApprovalRequest)
      const existingEntry = this.pendingApprovals.get(requestId);
      if (existingEntry) {
        // Check if we already received an early response
        if (existingEntry.earlyResponse) {
          this.logger.debug(`Found early response for request: ${requestId}`);
          this.pendingApprovals.delete(requestId);
          resolve(existingEntry.earlyResponse);
          return;
        }

        // Set up timeout
        const timeoutId = setTimeout(() => {
          this.pendingApprovals.delete(requestId);
          reject(
            new ApprovalTimeoutError(`Approval request timed out after ${timeout}ms`, requestId),
          );
        }, timeout);

        // Update the existing entry with the promise handlers and timeout
        existingEntry.resolve = (result: HITLWorkflowResult) => {
          clearTimeout(timeoutId);
          resolve(result);
        };
        existingEntry.reject = (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        };
        existingEntry.timeoutId = timeoutId;
        existingEntry.waitingForApproval = true;
      } else {
        // Set up timeout
        const timeoutId = setTimeout(() => {
          this.pendingApprovals.delete(requestId);
          reject(
            new ApprovalTimeoutError(`Approval request timed out after ${timeout}ms`, requestId),
          );
        }, timeout);

        // Store the pending approval (fallback if createApprovalRequest wasn't called)
        this.pendingApprovals.set(requestId, {
          request: {
            id: requestId,
            toolCall: {} as ToolCall, // Will be populated by createApprovalRequest
            timestamp: new Date().toISOString(),
          },
          resolve: (result: HITLWorkflowResult) => {
            clearTimeout(timeoutId);
            resolve(result);
          },
          reject: (error: Error) => {
            clearTimeout(timeoutId);
            reject(error);
          },
          timeoutId,
          waitingForApproval: true,
        });
      }

      this.logger.debug(`Waiting for approval: ${requestId} (timeout: ${timeout}ms)`);
    });
  }

  /**
   * Handle approval response from external system
   */
  async handleApprovalResponse(
    response: ApprovalResponse,
    headers?: Record<string, string>,
  ): Promise<void> {
    const pending = this.pendingApprovals.get(response.requestId);

    if (!pending) {
      throw new AgentGuardError(
        `Unknown approval request ID: ${response.requestId}`,
        'UNKNOWN_REQUEST_ID',
      );
    }

    // Validate the response if security is enabled
    if (this.webhookSecurity) {
      if (!headers) {
        throw new AgentGuardError(
          'Invalid approval response: Missing required security headers',
          'INVALID_RESPONSE_SIGNATURE',
        );
      }

      // First use validateResponse to check for missing headers and basic validation
      const responseBody = JSON.stringify(response);
      const validation = this.webhookSecurity.validateResponse(
        responseBody,
        headers,
        pending.request.id,
      );

      if (!validation.valid) {
        throw new AgentGuardError(
          `Invalid approval response: ${validation.reason}`,
          'INVALID_RESPONSE_SIGNATURE',
        );
      }

      // Additional check: ensure header request ID matches body request ID
      // This catches body tampering attempts with valid headers for different requests
      const headerRequestId = headers['x-agentguard-request-id'];
      if (headerRequestId !== response.requestId) {
        throw new AgentGuardError(
          'Request ID mismatch between body and headers',
          'REQUEST_ID_MISMATCH',
        );
      }

      // Check nonce to prevent replay attacks
      const nonce = headers['x-agentguard-nonce'];
      if (nonce) {
        if (this.processedNonces.has(nonce)) {
          throw new AgentGuardError(
            'Duplicate nonce detected - possible replay attack',
            'DUPLICATE_NONCE',
          );
        }
        this.processedNonces.set(nonce, Date.now());
      }
    }

    this.logger.info(`Received approval response`, {
      requestId: response.requestId,
      headerRequestId: headers?.['x-agentguard-request-id'],
      storedRequestId: pending.request.id,
      match: response.requestId === pending.request.id,
    });
    const responseTime = Date.now() - new Date(pending.request.timestamp).getTime();
    const result: HITLWorkflowResult = {
      approved: response.decision === 'APPROVE',
      reason: response.reason,
      approvedBy: response.approvedBy,
      responseTime,
    };

    // Check if waitForApproval has been called (real handlers are set)
    if (pending.waitingForApproval) {
      // Real handlers are set, resolve immediately
      this.pendingApprovals.delete(response.requestId);
      clearTimeout(pending.timeoutId);
      pending.resolve(result);
    } else {
      // waitForApproval hasn't been called yet, store the early response
      if (pending.earlyResponse) {
        this.logger.warn(
          `Received duplicate early response for request: ${response.requestId}. This may indicate duplicate webhook delivery.`,
        );
      } else {
        this.logger.debug(`Storing early response for request: ${response.requestId}`);
      }
      pending.earlyResponse = result;
    }
  }

  /**
   * Send webhook notification for approval request
   */
  private async sendWebhook(request: ApprovalRequest): Promise<void> {
    if (!this.webhookConfig) {
      throw new AgentGuardError('No webhook configuration available', 'NO_WEBHOOK_CONFIG');
    }

    let payload = {
      type: 'approval_request',
      request,
      timestamp: new Date().toISOString(),
    };

    // Encrypt sensitive data if configured
    if (this.webhookSecurity && this.webhookConfig.security?.encryptSensitiveData) {
      payload = this.encryptSensitiveData(payload);
    }

    const payloadString = JSON.stringify(payload);

    // Generate security headers
    const securityHeaders = this.webhookSecurity
      ? this.webhookSecurity.generateHeaders(payloadString, request.id)
      : {};

    // Default headers for webhook requests
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'AgentGuard/1.0',
    };

    for (let attempt = 1; attempt <= (this.webhookConfig.retries ?? 3); attempt++) {
      try {
        const response = await fetch(this.webhookConfig.url, {
          method: 'POST',
          headers: {
            ...defaultHeaders,
            ...securityHeaders,
            ...this.webhookConfig.headers,
          },
          body: payloadString,
          signal: AbortSignal.timeout(this.webhookConfig.timeout ?? 10000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        this.logger.debug(`Webhook sent successfully on attempt ${attempt}`, {
          requestId: request.id,
          status: response.status,
        });
        return;
      } catch (error) {
        this.logger.warn(`Webhook attempt ${attempt} failed`, {
          requestId: request.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (attempt === (this.webhookConfig.retries ?? 3)) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map(p => p.request);
  }

  /**
   * Cancel a pending approval request
   */
  cancelApproval(requestId: string, reason: string = 'Cancelled'): boolean {
    const pending = this.pendingApprovals.get(requestId);

    if (!pending) {
      return false;
    }

    this.logger.info(`Cancelling approval request: ${requestId}`, { reason });

    this.pendingApprovals.delete(requestId);
    clearTimeout(pending.timeoutId);
    pending.reject(
      new AgentGuardError(`Approval request cancelled: ${reason}`, 'APPROVAL_CANCELLED'),
    );

    return true;
  }

  /**
   * Clean up expired approval requests
   */
  cleanupExpiredRequests(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      const requestTime = new Date(pending.request.timestamp).getTime();
      const expiresAt = pending.request.expiresAt
        ? new Date(pending.request.expiresAt).getTime()
        : null;

      // Clean up if expired or very old (1 hour default)
      const maxAge = expiresAt || requestTime + 60 * 60 * 1000;

      if (now > maxAge) {
        this.logger.debug(`Cleaning up expired approval request: ${requestId}`);
        clearTimeout(pending.timeoutId);
        pending.reject(
          new ApprovalTimeoutError('Approval request expired during cleanup', requestId),
        );
        this.pendingApprovals.delete(requestId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} expired approval requests`);
    }

    return cleanedCount;
  }

  /**
   * Get statistics about pending approvals
   */
  getStats(): {
    pendingCount: number;
    oldestRequestAge: number | null;
    averageWaitTime: number | null;
  } {
    const pending = Array.from(this.pendingApprovals.values());
    const now = Date.now();

    if (pending.length === 0) {
      return {
        pendingCount: 0,
        oldestRequestAge: null,
        averageWaitTime: null,
      };
    }

    const ages = pending.map(p => now - new Date(p.request.timestamp).getTime());
    const oldestAge = Math.max(...ages);
    const averageAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;

    return {
      pendingCount: pending.length,
      oldestRequestAge: oldestAge,
      averageWaitTime: averageAge,
    };
  }

  private encryptSensitiveData(payload: any): any {
    if (!this.webhookSecurity || !this.webhookConfig?.security?.sensitiveFields) {
      return payload;
    }

    const result = JSON.parse(JSON.stringify(payload)); // Deep clone
    const sensitiveFields = this.webhookConfig.security.sensitiveFields;

    const encryptField = (obj: any, path: string) => {
      const parts = path.split('.');

      let current = obj;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];

        if (!part || !current[part]) {
          return;
        }

        current = current[part];
      }

      const fieldName = parts[parts.length - 1];

      if (fieldName && current[fieldName] !== undefined) {
        const encrypted = this.webhookSecurity!.encryptPayload({
          value: current[fieldName],
        });

        current[fieldName] = {
          ...encrypted,
        };
      }
    };

    for (const field of sensitiveFields) {
      encryptField(result, field);
    }

    return result;
  }

  private cleanupNonces(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    for (const [nonce, timestamp] of this.processedNonces.entries()) {
      if (now - timestamp > maxAge) {
        this.processedNonces.delete(nonce);
      }
    }

    this.logger.debug(`Cleaned up old nonces, ${this.processedNonces.size} remaining`);
  }

  destroy(): void {
    if (this.nonceCleanupInterval) {
      clearInterval(this.nonceCleanupInterval);
    }
  }
}
