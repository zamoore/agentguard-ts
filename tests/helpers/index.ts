import type { Policy, ToolCall, ApprovalResponse } from '../../src/types.js';

export function createMockPolicy(overrides?: Partial<Policy>): Policy {
  return {
    version: '1.0',
    name: 'test-policy',
    defaultAction: 'BLOCK',
    rules: [],
    ...overrides,
  };
}

export function createMockToolCall(overrides?: Partial<ToolCall>): ToolCall {
  return {
    toolName: 'test-tool',
    parameters: { test: true },
    agentId: 'test-agent',
    sessionId: 'test-session',
    ...overrides,
  };
}

export function createMockApprovalResponse(
  overrides?: Partial<ApprovalResponse>,
): ApprovalResponse {
  return {
    requestId: 'test-request-id',
    decision: 'APPROVE',
    reason: 'Test approval',
    approvedBy: 'test-user',
    ...overrides,
  };
}

export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
