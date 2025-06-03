import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentGuardCLI } from '../src/cli.js';
import { samplePolicies } from './fixtures/policies.js';

describe('CLI Tests', () => {
  let testDir: string;
  let cli: AgentGuardCLI;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentguard-cli-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    cli = new AgentGuardCLI();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit');
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should initialize a new policy file', async () => {
    const policyPath = join(testDir, 'new-policy.yaml');
    await cli.run(['node', 'agentguard', 'init', policyPath]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Created AgentGuard policy file'),
    );
  });

  it('should validate a policy file', async () => {
    const policyPath = join(testDir, 'valid-policy.yaml');
    await writeFile(policyPath, samplePolicies.complexPolicy);

    await cli.run(['node', 'agentguard', 'validate', policyPath]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Policy validation successful'),
    );
  });

  it('should test a tool call against policy', async () => {
    const policyPath = join(testDir, 'test-policy.yaml');
    await writeFile(policyPath, samplePolicies.complexPolicy);

    await cli.run(['node', 'agentguard', 'test', policyPath, 'read', 'table=users']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('This tool call would be ALLOWED'),
    );
  });

  it('should show help', async () => {
    await cli.run(['node', 'agentguard', 'help']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('AgentGuard CLI - Security toolkit for AI agents'),
    );
  });
});
