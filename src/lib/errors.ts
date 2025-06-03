import type { PolicyRule, ToolCall } from '../types.js';

export class AgentGuardError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentGuardError';
  }
}

export class PolicyViolationError extends AgentGuardError {
  constructor(
    message: string,
    public readonly rule: PolicyRule,
    public readonly toolCall: ToolCall,
  ) {
    super(message, 'POLICY_VIOLATION', { rule, toolCall });
    this.name = 'PolicyViolationError';
  }
}

export class ApprovalTimeoutError extends AgentGuardError {
  constructor(
    message: string,
    public readonly requestId: string,
  ) {
    super(message, 'APPROVAL_TIMEOUT', { requestId });
    this.name = 'ApprovalTimeoutError';
  }
}

export class PolicyLoadError extends AgentGuardError {
  constructor(
    message: string,
    public readonly policyPath?: string,
  ) {
    super(message, 'POLICY_LOAD_ERROR', { policyPath });
    this.name = 'PolicyLoadError';
  }
}
