/**
 * AgentGuard - Security toolkit for AI agents
 *
 * Provides declarative policy-based security controls for AI agent tool calls
 * with support for blocking, allowing, and human-in-the-loop approval workflows.
 */

import { AgentGuard } from './lib/agentguard.js';

import type { AgentGuardConfig } from './types.js';

// Core exports
export { AgentGuard } from './lib/agentguard.js';
export { PolicyLoader } from './lib/policy-loader.js';
export { HITLManager } from './lib/hitl-manager.js';
export { Logger } from './lib/logger.js';
export { WebhookSecurity } from './lib/webhook-security.js';

// Type exports
export type {
  // Core types
  PolicyDecision,
  ToolCall,
  GuardResult,
  AgentGuardConfig,
  WrappedTool,

  // Policy types
  Policy,
  PolicyRule,
  PolicyCondition,
  PolicyEvaluationContext,

  // HITL types
  ApprovalRequest,
  ApprovalResponse,
  HITLWorkflowResult,
  WebhookConfig,
  WebhookSecurityConfig,

  // Utility types
  LogLevel,
} from './types.js';

// Error exports
export {
  AgentGuardError,
  PolicyViolationError,
  ApprovalTimeoutError,
  PolicyLoadError,
} from './lib/errors.js';

// Version exports
export * from './version.js';

// Convenience factory function
export function createAgentGuard(config: AgentGuardConfig): AgentGuard {
  return new AgentGuard(config);
}

// Default export
export default AgentGuard;
