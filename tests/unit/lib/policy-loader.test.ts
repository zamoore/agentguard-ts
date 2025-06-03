import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { PolicyLoader } from '../../../src/lib/policy-loader.js';
import { PolicyLoadError } from '../../../src/lib/errors.js';
import { Logger } from '../../../src/lib/logger.js';
import { samplePolicies } from '../../fixtures/policies.js';

describe('PolicyLoader', () => {
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

  describe('loadPolicy()', () => {
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
      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow('Policy file not found');
    });

    it('should throw error for invalid YAML syntax', async () => {
      const policyPath = join(testDir, 'invalid.yaml');
      await writeFile(policyPath, 'invalid: yaml: content:::');

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(PolicyLoadError);
    });

    it('should throw error for missing required fields', async () => {
      const policyPath = join(testDir, 'missing-fields.yaml');
      await writeFile(policyPath, samplePolicies.invalidPolicy);

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(
        /Missing or invalid "defaultAction" field/,
      );
    });
  });

  describe('validation', () => {
    it('should validate policy structure', async () => {
      const policyPath = join(testDir, 'minimal.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Minimal Policy"
defaultAction: ALLOW
rules: []
`,
      );

      const policy = await policyLoader.loadPolicy(policyPath);

      expect(policy).toMatchObject({
        version: '1.0',
        name: 'Minimal Policy',
        defaultAction: 'ALLOW',
        rules: [],
      });
    });

    it('should validate webhook configuration', async () => {
      const policyPath = join(testDir, 'bad-webhook.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Bad Webhook"
defaultAction: ALLOW
webhook:
  url: "not-a-valid-url"
rules: []
`,
      );

      await expect(policyLoader.loadPolicy(policyPath)).rejects.toThrow(
        'Invalid webhook URL format',
      );
    });

    it('should set webhook defaults', async () => {
      const policyPath = join(testDir, 'webhook-defaults.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Webhook Defaults"
defaultAction: ALLOW
webhook:
  url: "https://example.com/webhook"
rules: []
`,
      );

      const policy = await policyLoader.loadPolicy(policyPath);

      expect(policy.webhook).toEqual({
        url: 'https://example.com/webhook',
        timeout: 10000,
        retries: 3,
        headers: {},
      });
    });
  });

  describe('rule validation', () => {
    it('should validate rule structure', async () => {
      const policyPath = join(testDir, 'rule-validation.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Rule Validation"
defaultAction: ALLOW
rules:
  - name: "Valid Rule"
    action: BLOCK
    conditions:
      - field: "toolCall.toolName"
        operator: "equals"
        value: "test"
`,
      );

      const policy = await policyLoader.loadPolicy(policyPath);
      const rule = policy.rules[0];

      expect(rule).toMatchObject({
        name: 'Valid Rule',
        action: 'BLOCK',
        priority: 0,
        conditions: [
          {
            field: 'toolCall.toolName',
            operator: 'equals',
            value: 'test',
          },
        ],
      });
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
      const policyPath = join(testDir, 'numeric-validation.yaml');
      await writeFile(
        policyPath,
        `
version: "1.0"
name: "Numeric Validation"
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

    it('should validate "in" operator requires array', async () => {
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

  describe('generateSamplePolicy()', () => {
    it('should generate a valid sample policy', () => {
      const samplePolicy = PolicyLoader.generateSamplePolicy();

      expect(samplePolicy).toContain('version: "1.0"');
      expect(samplePolicy).toContain('defaultAction: BLOCK');
      expect(samplePolicy).toContain('webhook:');
      expect(samplePolicy).toContain('rules:');
    });

    it('should generate parseable YAML', async () => {
      const samplePolicy = PolicyLoader.generateSamplePolicy();
      const policyPath = join(testDir, 'sample.yaml');
      await writeFile(policyPath, samplePolicy);

      const policy = await policyLoader.loadPolicy(policyPath);

      expect(policy.version).toBe('1.0');
      expect(policy.rules.length).toBeGreaterThan(0);
    });
  });
});
