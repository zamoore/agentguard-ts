import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentGuard } from '../../../src/index.js';
import { samplePolicies } from '../../fixtures/policies.js';
import { mockTools } from '../../fixtures/tools.js';

describe('Multi-Agent Workflow Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentguard-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
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

  it('should isolate agent contexts', async () => {
    const guard1 = new AgentGuard({
      policy: {
        version: '1.0',
        name: 'Agent1 Policy',
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'allow-agent1',
            action: 'ALLOW',
            conditions: [
              {
                field: 'toolCall.agentId',
                operator: 'equals',
                value: 'agent1',
              },
            ],
          },
        ],
      },
      enableLogging: false,
    });

    const guard2 = new AgentGuard({
      policy: {
        version: '1.0',
        name: 'Agent2 Policy',
        defaultAction: 'BLOCK',
        rules: [
          {
            name: 'allow-agent2',
            action: 'ALLOW',
            conditions: [
              {
                field: 'toolCall.agentId',
                operator: 'equals',
                value: 'agent2',
              },
            ],
          },
        ],
      },
      enableLogging: false,
    });

    await guard1.initialize();
    await guard2.initialize();

    const tool1 = guard1.protect('test', mockTools.simpleFunction, { agentId: 'agent1' });
    const tool2 = guard2.protect('test', mockTools.simpleFunction, { agentId: 'agent2' });

    // Each guard only allows its own agent
    expect(await tool1(1, 2)).toBe(3);
    expect(await tool2(3, 4)).toBe(7);

    // Cross-agent calls would be blocked
    const crossTool1 = guard1.protect('test', mockTools.simpleFunction, { agentId: 'agent2' });
    const crossTool2 = guard2.protect('test', mockTools.simpleFunction, { agentId: 'agent1' });

    await expect(crossTool1(1, 2)).rejects.toThrow();
    await expect(crossTool2(1, 2)).rejects.toThrow();
  });
});
