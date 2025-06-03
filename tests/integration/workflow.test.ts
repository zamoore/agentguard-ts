import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentGuard } from '../../src/lib/agentguard.js';
import { samplePolicies } from '../fixtures/policies.js';
import { mockTools } from '../fixtures/tools.js';

describe('Workflow Integration Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentguard-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    vi.clearAllMocks();
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

  it('should handle multiple agents with different policies', async () => {
    const policy1Path = join(testDir, 'policy1.yaml');
    const policy2Path = join(testDir, 'policy2.yaml');

    await writeFile(policy1Path, samplePolicies.allowAll);
    await writeFile(policy2Path, samplePolicies.blockAll);

    const guard1 = new AgentGuard({ policyPath: policy1Path, enableLogging: false });
    const guard2 = new AgentGuard({ policyPath: policy2Path, enableLogging: false });

    await guard1.initialize();
    await guard2.initialize();

    const tool1 = guard1.protect('test', mockTools.simpleFunction);
    const tool2 = guard2.protect('test', mockTools.simpleFunction);

    // Guard 1 allows, Guard 2 blocks
    expect(await tool1(1, 2)).toBe(3);
    await expect(tool2(1, 2)).rejects.toThrow();
  });

  it('should reload policy dynamically', async () => {
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
