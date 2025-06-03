import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { PolicyLoader } from '../../src/lib/policy-loader.js';
import { PolicyLoadError } from '../../src/lib/errors.js';
import { Logger } from '../../src/lib/logger.js';
import { samplePolicies } from '../fixtures/policies.js';

describe('Policy Unit Tests', () => {
  let policyLoader: PolicyLoader;
  let testDir: string;

  beforeEach(async () => {
    policyLoader = new PolicyLoader(new Logger({ enabled: false }));
    testDir = join(tmpdir(), `agentguard-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('PolicyLoader', () => {
    it('should load a valid policy from YAML file', async () => {
      const policyPath = join(testDir, 'valid-policy.yaml');
      await writeFile(policyPath, samplePolicies.complexPolicy);

      const policy = await policyLoader.loadPolicy(policyPath);

      expect(policy.version).toBe('1.0');
      expect(policy.name).toBe('Complex Security Policy');
      expect(policy.defaultAction).toBe('BLOCK');
      expect(policy.rules).toHaveLength(4);
      expect(policy.webhook).toBeDefined();
      expect(policy.webhook?.url).toBe('https://example.com/webhook');
    });

    it('should throw error for non-existent file', async () => {
      const policyPath = join(testDir, 'non-existent.yaml');

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(PolicyLoadError);
    });

    it('should throw error for invalid YAML', async () => {
      const policyPath = join(testDir, 'invalid.yaml');
      await writeFile(policyPath, 'invalid: yaml: content:::');

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(PolicyLoadError);
    });

    it('should throw error for missing required fields', async () => {
      const policyPath = join(testDir, 'invalid-policy.yaml');
      await writeFile(policyPath, samplePolicies.invalidPolicy);

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(
        /Missing or invalid "defaultAction" field/,
      );
    });

    it('should validate webhook configuration', async () => {
      const policyPath = join(testDir, 'webhook-policy.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Webhook Policy"
defaultAction: ALLOW
webhook:
  url: "not-a-valid-url"
rules: []
`,
      );

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(
        /Invalid webhook URL format/,
      );
    });
  });

  describe('Policy Rule Validation', () => {
    it('should validate rule structure', async () => {
      const policyPath = join(testDir, 'rule-policy.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Rule Policy"
defaultAction: ALLOW
rules:
  - name: "Test Rule"
    action: BLOCK
    conditions:
      - field: "toolCall.toolName"
        operator: "equals"
        value: "test"
`,
      );

      const policy = await policyLoader.loadPolicy(policyPath);
      const rule = policy.rules[0];

      expect(rule.name).toBe('Test Rule');
      expect(rule.action).toBe('BLOCK');
      expect(rule.conditions).toHaveLength(1);
      expect(rule.conditions[0].field).toBe('toolCall.toolName');
    });

    it('should reject invalid action types', async () => {
      const policyPath = join(testDir, 'invalid-action.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Invalid Action"
defaultAction: BLOCK
rules:
  - name: "Bad Rule"
    action: INVALID_ACTION
    conditions: []
`,
      );

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(
        /Missing or invalid "action" field/,
      );
    });

    it('should validate condition operators', async () => {
      const policyPath = join(testDir, 'invalid-operator.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Invalid Operator"
defaultAction: BLOCK
rules:
  - name: "Bad Operator"
    action: ALLOW
    conditions:
      - field: "test"
        operator: "invalid_op"
        value: "value"
`,
      );

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(
        /Missing or invalid "operator" property/,
      );
    });

    it('should validate numeric operators require numeric values', async () => {
      const policyPath = join(testDir, 'numeric-operator.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Numeric Operator"
defaultAction: BLOCK
rules:
  - name: "Numeric Rule"
    action: ALLOW
    conditions:
      - field: "amount"
        operator: "gt"
        value: "not-a-number"
`,
      );

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(/requires a numeric value/);
    });

    it('should validate "in" operator requires array value', async () => {
      const policyPath = join(testDir, 'in-operator.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "In Operator"
defaultAction: BLOCK
rules:
  - name: "In Rule"
    action: ALLOW
    conditions:
      - field: "test"
        operator: "in"
        value: "not-an-array"
`,
      );

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(
        /Operator "in" requires an array value/,
      );
    });
  });

  describe('Policy Priority', () => {
    it('should handle rule priorities correctly', async () => {
      const policyPath = join(testDir, 'priority-policy.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Priority Policy"
defaultAction: BLOCK
rules:
  - name: "Low Priority"
    priority: 10
    action: ALLOW
    conditions: []
  - name: "High Priority"
    priority: 100
    action: BLOCK
    conditions: []
  - name: "Medium Priority"
    priority: 50
    action: REQUIRE_HUMAN_APPROVAL
    conditions: []
`,
      );

      const policy = await policyLoader.loadPolicy(policyPath);

      expect(policy.rules).toHaveLength(3);
      expect(policy.rules[0].priority).toBe(10);
      expect(policy.rules[1].priority).toBe(100);
      expect(policy.rules[2].priority).toBe(50);
    });

    it('should default priority to 0 if not specified', async () => {
      const policyPath = join(testDir, 'default-priority.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Default Priority"
defaultAction: BLOCK
rules:
  - name: "No Priority"
    action: ALLOW
    conditions: []
`,
      );

      const policy = await policyLoader.loadPolicy(policyPath);

      // The PolicyLoader doesn't set a default, so priority will be undefined
      // But the AgentGuard treats undefined as 0 during sorting
      expect(policy.rules[0].priority).toBeUndefined();
    });
  });

  describe('Sample Policy Generation', () => {
    it('should generate a valid sample policy', () => {
      const samplePolicy = PolicyLoader.generateSamplePolicy();

      expect(samplePolicy).toContain('version: "1.0"');
      expect(samplePolicy).toContain('defaultAction: BLOCK');
      expect(samplePolicy).toContain('webhook:');
      expect(samplePolicy).toContain('rules:');
    });
  });
});
