import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as yaml from 'js-yaml';
import type { Policy, PolicyRule, PolicyCondition } from '../types.js';
import { PolicyLoadError } from './errors.js';
import type { Logger } from './logger.js';

export class PolicyLoader {
  constructor(private readonly logger: Logger) {}

  /**
   * Load and validate a policy from a YAML file
   */
  async loadPolicy(policyPath: string): Promise<Policy> {
    this.logger.debug(`Loading policy from: ${policyPath}`);

    if (!existsSync(policyPath)) {
      throw new PolicyLoadError(`Policy file not found: ${policyPath}`, policyPath);
    }

    try {
      const fileContent = await readFile(policyPath, 'utf-8');
      const rawPolicy = yaml.load(fileContent) as any;

      if (!rawPolicy || typeof rawPolicy !== 'object') {
        throw new PolicyLoadError('Policy file must contain a valid YAML object', policyPath);
      }

      const policy = this.validateAndNormalizePolicy(rawPolicy, policyPath);
      this.logger.debug('Policy loaded and validated successfully', {
        rulesCount: policy.rules.length,
        defaultAction: policy.defaultAction,
      });

      return policy;
    } catch (error) {
      if (error instanceof PolicyLoadError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new PolicyLoadError(`Failed to load policy: ${message}`, policyPath);
    }
  }

  /**
   * Validate and normalize a policy object
   */
  private validateAndNormalizePolicy(rawPolicy: any, policyPath: string): Policy {
    const errors: string[] = [];

    // Validate required fields
    if (!rawPolicy.version || typeof rawPolicy.version !== 'string') {
      errors.push('Missing or invalid "version" field');
    }

    if (!rawPolicy.name || typeof rawPolicy.name !== 'string') {
      errors.push('Missing or invalid "name" field');
    }

    if (!rawPolicy.defaultAction || !this.isValidPolicyDecision(rawPolicy.defaultAction)) {
      errors.push(
        'Missing or invalid "defaultAction" field. Must be ALLOW, BLOCK, or REQUIRE_HUMAN_APPROVAL',
      );
    }

    if (!Array.isArray(rawPolicy.rules)) {
      errors.push('"rules" must be an array');
    }

    if (errors.length > 0) {
      throw new PolicyLoadError(`Policy validation failed: ${errors.join(', ')}`, policyPath);
    }

    // Validate and normalize rules
    const rules: PolicyRule[] = [];
    for (let i = 0; i < rawPolicy.rules.length; i++) {
      try {
        const rule = this.validateAndNormalizeRule(rawPolicy.rules[i], i);
        rules.push(rule);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Rule ${i}: ${message}`);
      }
    }

    if (errors.length > 0) {
      throw new PolicyLoadError(`Policy validation failed: ${errors.join(', ')}`, policyPath);
    }

    // Validate webhook config if present
    let webhook;
    if (rawPolicy.webhook) {
      webhook = this.validateWebhookConfig(rawPolicy.webhook);
    }

    return {
      version: rawPolicy.version,
      name: rawPolicy.name,
      description: rawPolicy.description || undefined,
      defaultAction: rawPolicy.defaultAction,
      rules,
      webhook,
    };
  }

  /**
   * Validate and normalize a rule
   */
  private validateAndNormalizeRule(rawRule: any, index: number): PolicyRule {
    const errors: string[] = [];

    if (!rawRule.name || typeof rawRule.name !== 'string') {
      errors.push('Missing or invalid "name" field');
    }

    if (!rawRule.action || !this.isValidPolicyDecision(rawRule.action)) {
      errors.push(
        'Missing or invalid "action" field. Must be ALLOW, BLOCK, or REQUIRE_HUMAN_APPROVAL',
      );
    }

    if (!Array.isArray(rawRule.conditions)) {
      errors.push('"conditions" must be an array');
    }

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }

    // Validate conditions
    const conditions: PolicyCondition[] = [];
    for (let i = 0; i < rawRule.conditions.length; i++) {
      try {
        const condition = this.validateAndNormalizeCondition(rawRule.conditions[i]);
        conditions.push(condition);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Condition ${i}: ${message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }

    return {
      name: rawRule.name,
      description: rawRule.description || undefined,
      conditions,
      action: rawRule.action,
      priority: typeof rawRule.priority === 'number' ? rawRule.priority : 0,
    };
  }

  /**
   * Validate and normalize a condition
   */
  private validateAndNormalizeCondition(rawCondition: any): PolicyCondition {
    if (!rawCondition.field || typeof rawCondition.field !== 'string') {
      throw new Error('Missing or invalid "field" property');
    }

    if (!rawCondition.operator || !this.isValidOperator(rawCondition.operator)) {
      throw new Error(
        'Missing or invalid "operator" property. Must be one of: equals, contains, startsWith, endsWith, regex, in, gt, lt, gte, lte',
      );
    }

    if (rawCondition.value === undefined) {
      throw new Error('Missing "value" property');
    }

    // Additional validation for specific operators
    if (rawCondition.operator === 'in' && !Array.isArray(rawCondition.value)) {
      throw new Error('Operator "in" requires an array value');
    }

    if (['gt', 'lt', 'gte', 'lte'].includes(rawCondition.operator)) {
      const numValue =
        typeof rawCondition.value === 'number'
          ? rawCondition.value
          : parseFloat(String(rawCondition.value));
      if (isNaN(numValue)) {
        throw new Error(`Operator "${rawCondition.operator}" requires a numeric value`);
      }
    }

    return {
      field: rawCondition.field,
      operator: rawCondition.operator,
      value: rawCondition.value,
    };
  }

  /**
   * Validate webhook configuration
   */
  private validateWebhookConfig(rawWebhook: any): any {
    if (!rawWebhook.url || typeof rawWebhook.url !== 'string') {
      throw new Error('Webhook configuration missing or invalid "url" field');
    }

    // Basic URL validation
    try {
      new URL(rawWebhook.url);
    } catch {
      throw new Error('Invalid webhook URL format');
    }

    return {
      url: rawWebhook.url,
      timeout: typeof rawWebhook.timeout === 'number' ? rawWebhook.timeout : 10000,
      retries: typeof rawWebhook.retries === 'number' ? rawWebhook.retries : 3,
      headers:
        rawWebhook.headers && typeof rawWebhook.headers === 'object' ? rawWebhook.headers : {},
    };
  }

  /**
   * Check if a string is a valid policy decision
   */
  private isValidPolicyDecision(value: string): boolean {
    return ['ALLOW', 'BLOCK', 'REQUIRE_HUMAN_APPROVAL'].includes(value);
  }

  /**
   * Check if a string is a valid condition operator
   */
  private isValidOperator(value: string): boolean {
    return [
      'equals',
      'contains',
      'startsWith',
      'endsWith',
      'regex',
      'in',
      'gt',
      'lt',
      'gte',
      'lte',
    ].includes(value);
  }

  /**
   * Generate a sample policy file content
   */
  static generateSamplePolicy(): string {
    return `# AgentGuard Policy Configuration
version: "1.0"
name: "Sample Security Policy"
description: "Example policy demonstrating AgentGuard capabilities"

# Default action when no rules match
defaultAction: BLOCK

# Webhook configuration for human approval workflow
webhook:
  url: "https://your-approval-system.com/agentguard/webhook"
  timeout: 30000
  retries: 3
  headers:
    Authorization: "Bearer your-token-here"

# Security rules (evaluated in priority order)
rules:
  # Allow safe read operations
  - name: "Allow Read Operations"
    description: "Allow database reads and API gets"
    priority: 100
    action: ALLOW
    conditions:
      - field: "toolCall.toolName"
        operator: "in"
        value: ["database_read", "api_get", "file_read"]

  # Block dangerous operations
  - name: "Block Dangerous Operations"
    description: "Block any delete or admin operations"
    priority: 200
    action: BLOCK
    conditions:
      - field: "toolCall.toolName"
        operator: "contains"
        value: "delete"

  # Require approval for financial operations
  - name: "Financial Operations Need Approval"
    description: "Any financial transaction requires human approval"
    priority: 150
    action: REQUIRE_HUMAN_APPROVAL
    conditions:
      - field: "toolCall.parameters.category"
        operator: "equals"
        value: "financial"

  # Require approval for large amounts
  - name: "Large Amount Approval"
    description: "Transactions over $1000 need approval"
    priority: 140
    action: REQUIRE_HUMAN_APPROVAL
    conditions:
      - field: "toolCall.parameters.amount"
        operator: "gt"
        value: 1000

  # Block operations on production during business hours
  - name: "Production Safety"
    description: "Block production operations during business hours"
    priority: 180
    action: REQUIRE_HUMAN_APPROVAL
    conditions:
      - field: "toolCall.parameters.environment"
        operator: "equals"
        value: "production"
      - field: "toolCall.toolName"
        operator: "regex"
        value: "(deploy|restart|scale)"
`;
  }
}
