import { vi } from 'vitest';

import type { ApprovalRequest, ApprovalResponse } from '../../src/types.js';

export class MockWebhookServer {
  private responses = new Map<string, ApprovalResponse>();
  public receivedRequests: ApprovalRequest[] = [];

  constructor() {
    this.setupFetchMock();
  }

  private setupFetchMock() {
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      const body = JSON.parse(options?.body as string);

      if (body.type === 'approval_request') {
        this.receivedRequests.push(body.request);
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
  }

  setApprovalResponse(requestId: string, response: ApprovalResponse) {
    this.responses.set(requestId, response);
  }

  reset() {
    this.receivedRequests = [];
    this.responses.clear();
  }
}
