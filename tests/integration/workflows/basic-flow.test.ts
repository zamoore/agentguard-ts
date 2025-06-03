// tests/integration/workflows/basic-flow.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentGuard } from '../../../src/index.js';
import { samplePolicies } from '../../fixtures/policies.js';
import { mockTools } from '../../fixtures/tools.js';

describe('Basic Workflow Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentguard-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should handle complete workflow from policy load to tool execution', async () => {
    const policyPath = join(testDir, 'policy.yaml');
    await writeFile(policyPath, samplePolicies.complexPolicy);

    const guard = new AgentGuard({ policyPath, enableLogging: false });
    await guard.initialize();

    // Test allowed operation
    const readTool = guard.protect('read', mockTools.databaseRead);
    const readResult = await readTool({ table: 'users' });
    expect(readResult).toEqual({ rows: [], table: 'users' });

    // Test blocked operation
    const deleteTool = guard.protect('deleteUser', mockTools.databaseDelete);
    await expect(deleteTool({ table: 'users', id: '123' })).rejects.toThrow(
      'Tool call blocked by policy',
    );
  });

  it('should handle policy reload during runtime', async () => {
    const policyPath = join(testDir, 'dynamic-policy.yaml');
    await writeFile(policyPath, samplePolicies.allowAll);

    const guard = new AgentGuard({ policyPath, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('test', mockTools.simpleFunction);

    // Initially allowed
    expect(await tool(1, 2)).toBe(3);

    // Update policy to block
    await writeFile(policyPath, samplePolicies.blockAll);
    await guard.reloadPolicy();

    // Now blocked
    await expect(tool(1, 2)).rejects.toThrow();
  });
});
