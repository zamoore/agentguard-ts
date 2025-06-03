import {
  AgentGuardError,
  PolicyViolationError,
  ApprovalTimeoutError,
  PolicyLoadError,
} from './errors.js';
import { PolicyLoader } from './policy-loader.js';
import { HITLManager } from './hitl-manager.js';
import { Logger } from './logger.js';

import type {
  AgentGuardConfig,
  ResolvedAgentGuardConfig,
  Policy,
  ToolCall,
  GuardResult,
  PolicyRule,
  PolicyCondition,
  ApprovalResponse,
  HITLWorkflowResult,
  WrappedTool,
  PolicyEvaluationContext,
  WebhookConfig,
} from '../types.js';

export class AgentGuard {
  private policy: Policy | null = null;
  private readonly policyLoader: PolicyLoader;
  private hitlManager: HITLManager;
  private readonly logger: Logger;
  private readonly config: ResolvedAgentGuardConfig;

  constructor(config: AgentGuardConfig) {
    const baseConfig = {
      webhook: config.webhook,
      enableLogging: config.enableLogging ?? true,
      timeout: config.timeout ?? 30000,
      cache: {
        enabled: config.cache?.enabled ?? true,
        ttl: config.cache?.ttl ?? 300000,
      },
    };

    this.config =
      'policy' in config
        ? { ...baseConfig, policy: config.policy, policyPath: undefined }
        : { ...baseConfig, policyPath: config.policyPath, policy: undefined };

    this.logger = new Logger({ enabled: this.config.enableLogging ?? true });
    this.policyLoader = new PolicyLoader(this.logger);
    this.hitlManager = new HITLManager(null, this.logger);
  }

  /**
   * Initialize AgentGuard by loading the policy
   */
  async initialize(): Promise<void> {
    try {
      if (this.config.policy) {
        this.policy = this.config.policy;
        this.logger.info('Using provided policy configuration');
      } else if (this.config.policyPath) {
        this.policy = await this.policyLoader.loadPolicy(this.config.policyPath);
        this.logger.info(`Loaded policy from ${this.config.policyPath}`);
      } else {
        throw new PolicyLoadError('No policy or policyPath provided', undefined);
      }

      const webhookConfig = this.policy.webhook || this.config.webhook || null;
      this.hitlManager = new HITLManager(webhookConfig, this.logger);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      throw new PolicyLoadError(
        `Failed to initialize AgentGuard: ${message}`,
        this.config.policyPath,
      );
    }
  }

  /**
   * Wrap a tool function with AgentGuard protection
   */
  protect<T extends (...args: any[]) => any>(
    toolName: string,
    toolFunction: T,
    options?: {
      agentId?: string;
      sessionId?: string;
      metadata?: Record<string, unknown>;
    },
  ): WrappedTool<T> {
    const wrappedFunction = async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      // Create tool call object
      const toolCall: ToolCall = {
        toolName,
        parameters: this.extractParameters(args),
        ...(options?.agentId && { agentId: options.agentId }),
        ...(options?.sessionId && { sessionId: options.sessionId }),
        ...(options?.metadata && { metadata: options.metadata }),
      };

      // Evaluate the tool call against policy
      const guardResult = await this.evaluateToolCall(toolCall);

      // Handle the decision
      switch (guardResult.decision) {
        case 'ALLOW':
          this.logger.info(`Tool call allowed: ${toolName}`, { toolCall, rule: guardResult.rule });
          return await toolFunction(...args);

        case 'BLOCK':
          this.logger.warn(`Tool call blocked: ${toolName}`, { toolCall, rule: guardResult.rule });
          throw new PolicyViolationError(
            `Tool call blocked by policy: ${guardResult.reason}`,
            guardResult.rule!,
            toolCall,
          );

        case 'REQUIRE_HUMAN_APPROVAL':
          this.logger.info(`Tool call requires approval: ${toolName}`, {
            toolCall,
            rule: guardResult.rule,
          });
          const approval = await this.requestHumanApproval(
            toolCall,
            guardResult.approvalRequestId!,
          );

          if (approval.approved) {
            this.logger.info(`Tool call approved: ${toolName}`, { toolCall, approval });
            return await toolFunction(...args);
          } else {
            this.logger.warn(`Tool call denied: ${toolName}`, { toolCall, approval });
            throw new PolicyViolationError(
              `Tool call denied by human reviewer: ${approval.reason || 'No reason provided'}`,
              guardResult.rule!,
              toolCall,
            );
          }

        default:
          throw new AgentGuardError(
            `Unknown policy decision: ${guardResult.decision}`,
            'UNKNOWN_DECISION',
          );
      }
    };

    // Add metadata to identify wrapped functions
    Object.defineProperty(wrappedFunction, '__agentguard_wrapped', {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false,
    });

    Object.defineProperty(wrappedFunction, '__original_function', {
      value: toolFunction,
      writable: false,
      enumerable: false,
      configurable: false,
    });

    return wrappedFunction as WrappedTool<T>;
  }

  /**
   * Evaluate a tool call against the loaded policy
   */
  private async evaluateToolCall(toolCall: ToolCall): Promise<GuardResult> {
    if (!this.policy) {
      throw new AgentGuardError(
        'AgentGuard not initialized. Call initialize() first.',
        'NOT_INITIALIZED',
      );
    }

    const context: PolicyEvaluationContext = {
      toolCall,
      policy: this.policy,
      timestamp: new Date().toISOString(),
    };

    // Sort rules by priority (higher priority first)
    const sortedRules = [...this.policy.rules].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );

    // Evaluate rules in priority order
    for (const rule of sortedRules) {
      if (await this.evaluateRule(rule, context)) {
        this.logger.debug(`Rule matched: ${rule.name}`, { rule, toolCall });

        if (rule.action === 'REQUIRE_HUMAN_APPROVAL') {
          const approvalRequestId = await this.hitlManager.createApprovalRequest(toolCall);
          return {
            decision: rule.action,
            rule,
            reason: `Matched rule: ${rule.name}`,
            approvalRequestId,
          };
        }

        return {
          decision: rule.action,
          rule,
          reason: `Matched rule: ${rule.name}`,
        };
      }
    }

    // No rules matched, use default action
    this.logger.debug('No rules matched, using default action', {
      defaultAction: this.policy.defaultAction,
      toolCall,
    });

    if (this.policy.defaultAction === 'REQUIRE_HUMAN_APPROVAL') {
      const approvalRequestId = await this.hitlManager.createApprovalRequest(toolCall);
      return {
        decision: this.policy.defaultAction,
        reason: 'No matching rules found, using default action',
        approvalRequestId,
      };
    }

    return {
      decision: this.policy.defaultAction,
      reason: 'No matching rules found, using default action',
    };
  }

  /**
   * Evaluate if a rule matches the current context
   */
  private async evaluateRule(rule: PolicyRule, context: PolicyEvaluationContext): Promise<boolean> {
    // All conditions must be true for the rule to match
    for (const condition of rule.conditions) {
      if (!(await this.evaluateCondition(condition, context))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a single condition
   */
  private async evaluateCondition(
    condition: PolicyCondition,
    context: PolicyEvaluationContext,
  ): Promise<boolean> {
    const value = this.extractFieldValue(condition.field, context);

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;

      case 'contains':
        return typeof value === 'string' && typeof condition.value === 'string'
          ? value.includes(condition.value)
          : false;

      case 'startsWith':
        return typeof value === 'string' && typeof condition.value === 'string'
          ? value.startsWith(condition.value)
          : false;

      case 'endsWith':
        return typeof value === 'string' && typeof condition.value === 'string'
          ? value.endsWith(condition.value)
          : false;

      case 'regex':
        if (typeof value === 'string' && typeof condition.value === 'string') {
          const regex = new RegExp(condition.value);
          return regex.test(value);
        }
        return false;

      case 'in':
        return Array.isArray(condition.value) ? condition.value.includes(value) : false;

      case 'gt':
      case 'lt':
      case 'gte':
      case 'lte':
        return this.evaluateNumericCondition(condition.operator, value, condition.value);

      default:
        this.logger.warn(`Unknown condition operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Evaluate numeric conditions
   */
  private evaluateNumericCondition(
    operator: string,
    value: unknown,
    conditionValue: unknown,
  ): boolean {
    const numValue = typeof value === 'number' ? value : parseFloat(String(value));
    const numConditionValue =
      typeof conditionValue === 'number' ? conditionValue : parseFloat(String(conditionValue));

    if (isNaN(numValue) || isNaN(numConditionValue)) {
      return false;
    }

    switch (operator) {
      case 'gt':
        return numValue > numConditionValue;
      case 'lt':
        return numValue < numConditionValue;
      case 'gte':
        return numValue >= numConditionValue;
      case 'lte':
        return numValue <= numConditionValue;
      default:
        return false;
    }
  }

  /**
   * Extract field value from context using dot notation
   */
  private extractFieldValue(field: string, context: PolicyEvaluationContext): unknown {
    const parts = field.split('.');
    let value: any = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Extract parameters from function arguments
   */
  private extractParameters(args: unknown[]): Record<string, unknown> {
    if (args.length === 0) {
      return {};
    }

    // If first argument is an object, use it as parameters
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      return args[0] as Record<string, unknown>;
    }

    // Otherwise, create indexed parameters
    const params: Record<string, unknown> = {};
    args.forEach((arg, index) => {
      params[`arg${index}`] = arg;
    });

    return params;
  }

  /**
   * Request human approval for a tool call
   */
  private async requestHumanApproval(
    toolCall: ToolCall,
    requestId: string,
  ): Promise<HITLWorkflowResult> {
    try {
      return await this.hitlManager.waitForApproval(requestId, this.config.timeout);
    } catch (error) {
      if (error instanceof ApprovalTimeoutError) {
        throw error;
      }
      throw new AgentGuardError(
        `Failed to get human approval: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'APPROVAL_FAILED',
      );
    }
  }

  /**
   * Handle approval response from external system
   */
  async handleApprovalResponse(response: ApprovalResponse): Promise<void> {
    await this.hitlManager.handleApprovalResponse(response);
  }

  /**
   * Get current policy
   */
  getPolicy(): Policy | null {
    return this.policy;
  }

  /**
   * Reload policy from file
   */
  async reloadPolicy(): Promise<void> {
    if (this.config.policy) {
      this.logger.warn('Cannot reload policy when using provided policy configuration');
      return;
    }

    if (!this.config.policyPath) {
      throw new PolicyLoadError('No policy path available for reload', undefined);
    }

    this.policy = await this.policyLoader.loadPolicy(this.config.policyPath);
    this.logger.info(`Policy reloaded from ${this.config.policyPath}`);
  }
}
