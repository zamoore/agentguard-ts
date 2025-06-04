export type PolicyDecision = 'ALLOW' | 'BLOCK' | 'REQUIRE_HUMAN_APPROVAL';

export type ToolCall = {
  readonly toolName: string;
  readonly parameters: Record<string, unknown>;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly metadata?: Record<string, unknown>;
};

export type PolicyRule = {
  readonly name: string;
  readonly description?: string;
  readonly conditions: PolicyCondition[];
  readonly action: PolicyDecision;
  readonly priority?: number;
};

export type PolicyCondition = {
  readonly field: string;
  readonly operator:
    | 'equals'
    | 'contains'
    | 'startsWith'
    | 'endsWith'
    | 'regex'
    | 'in'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte';
  readonly value: unknown;
};

export type Policy = {
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly defaultAction: PolicyDecision;
  readonly rules: PolicyRule[];
  readonly webhook?: WebhookConfig;
};

export type WebhookSecurityConfig = {
  readonly signingSecret: string;
  readonly encryptionKey?: string;
  readonly encryptSensitiveData?: boolean;
  readonly sensitiveFields?: string[];
};

export type WebhookConfig = {
  readonly url: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly headers?: Record<string, string>;
  readonly security?: WebhookSecurityConfig;
};

export type ApprovalRequest = {
  readonly id: string;
  readonly toolCall: ToolCall;
  readonly timestamp: string;
  readonly expiresAt?: string;
  readonly metadata?: Record<string, unknown>;
};

export type ApprovalResponse = {
  readonly requestId: string;
  readonly decision: 'APPROVE' | 'DENY';
  readonly reason?: string;
  readonly approvedBy?: string;
};

export type GuardResult = {
  readonly decision: PolicyDecision;
  readonly rule?: PolicyRule;
  readonly reason: string;
  readonly approvalRequestId?: string;
};

export type AgentGuardConfig = {
  readonly webhook?: WebhookConfig;
  readonly enableLogging?: boolean;
  readonly timeout?: number;
  readonly cache?: {
    readonly enabled: boolean;
    readonly ttl?: number;
  };
} & (
  | { readonly policyPath: string; readonly policy?: never }
  | { readonly policy: Policy; readonly policyPath?: never }
);

export type ResolvedAgentGuardConfig = {
  readonly policyPath?: string | undefined;
  readonly policy?: Policy | undefined;
  readonly webhook?: WebhookConfig | undefined;
  readonly enableLogging: boolean;
  readonly timeout: number;
  readonly cache: {
    readonly enabled: boolean;
    readonly ttl: number;
  };
};

export type WrappedTool<T extends (...args: any[]) => any> = T & {
  readonly __agentguard_wrapped: true;
  readonly __original_function: T;
};

export type PolicyEvaluationContext = {
  readonly toolCall: ToolCall;
  readonly policy: Policy;
  readonly timestamp: string;
};

export type HITLWorkflowResult = {
  readonly approved: boolean;
  readonly reason: string | undefined;
  readonly approvedBy: string | undefined;
  readonly responseTime: number;
};

// Logging types
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export type LogHandler = (entry: LogEntry) => void;
