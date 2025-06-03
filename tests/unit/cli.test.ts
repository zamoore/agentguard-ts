import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, rm, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentGuardCLI } from '../../src/cli.js';
import { samplePolicies } from '../fixtures/policies.js';

describe('AgentGuardCLI', () => {
  let testDir: string;
  let cli: AgentGuardCLI;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let fetchSpy: any;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentguard-cli-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    cli = new AgentGuardCLI();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        if (code && code !== 0) {
          throw new Error('Process exit');
        }
        return undefined as never;
      });

    // Mock fetch to prevent actual webhook requests
    fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    global.fetch = fetchSpy as any;
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('init command', () => {
    it('should create a new policy file', async () => {
      const policyPath = join(testDir, 'new-policy.yaml');
      await cli.run(['node', 'agentguard', 'init', policyPath]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created AgentGuard policy file'),
      );

      const content = await readFile(policyPath, 'utf-8');
      expect(content).toContain('version: "1.0"');
    });

    it('should not overwrite existing file', async () => {
      const policyPath = join(testDir, 'existing.yaml');
      await writeFile(policyPath, 'existing content');

      await cli.run(['node', 'agentguard', 'init', policyPath]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Policy file already exists'),
      );
    });

    it('should use default filename', async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        await cli.run(['node', 'agentguard', 'init']);

        const content = await readFile('agentguard-policy.yaml', 'utf-8');
        expect(content).toContain('version: "1.0"');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('validate command', () => {
    it('should validate a valid policy', async () => {
      const policyPath = join(testDir, 'valid-policy.yaml');
      await writeFile(policyPath, samplePolicies.complexPolicy);

      await cli.run(['node', 'agentguard', 'validate', policyPath]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Policy validation successful'),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Complex Security Policy'),
      );
    });

    it('should report validation errors', async () => {
      const policyPath = join(testDir, 'invalid-policy.yaml');
      await writeFile(policyPath, samplePolicies.invalidPolicy);

      await expect(cli.run(['node', 'agentguard', 'validate', policyPath])).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Policy validation failed'),
      );
    });

    it('should handle non-existent file', async () => {
      await cli.run(['node', 'agentguard', 'validate', '/non/existent.yaml']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Policy file not found'),
      );
    });
  });

  describe('test command', () => {
    it('should test allowed tool call', async () => {
      const policyPath = join(testDir, 'test-policy.yaml');
      await writeFile(policyPath, samplePolicies.complexPolicy);

      await cli.run(['node', 'agentguard', 'test', policyPath, 'read', 'table=users']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('This tool call would be ALLOWED'),
      );
    });

    it('should test blocked tool call', async () => {
      const policyPath = join(testDir, 'test-policy.yaml');
      await writeFile(policyPath, samplePolicies.complexPolicy);

      await cli.run(['node', 'agentguard', 'test', policyPath, 'deleteUser', 'id=123']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('This tool call would be BLOCKED'),
      );
    });

    it('should parse JSON parameter values', async () => {
      const policyPath = join(testDir, 'test-policy.yaml');
      await writeFile(policyPath, samplePolicies.complexPolicy);

      await cli.run([
        'node',
        'agentguard',
        'test',
        policyPath,
        'financialTransaction',
        'amount=5000',
        'category="financial"',
      ]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('REQUIRE HUMAN APPROVAL'));
    });

    it('should show usage when missing tool name', async () => {
      await cli.run(['node', 'agentguard', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });
  });

  describe('help command', () => {
    it('should show help information', async () => {
      await cli.run(['node', 'agentguard', 'help']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('AgentGuard CLI - Security toolkit for AI agents'),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Commands:'));
    });

    it('should show help when no command given', async () => {
      await cli.run(['node', 'agentguard']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('AgentGuard CLI'));
    });
  });

  describe('error handling', () => {
    it('should handle unknown commands', async () => {
      await expect(cli.run(['node', 'agentguard', 'unknown'])).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown command: unknown'),
      );
    });

    it('should handle command errors gracefully', async () => {
      // Force an error by using a bad policy
      const policyPath = join(testDir, 'bad.yaml');
      await writeFile(policyPath, 'invalid yaml content');

      await expect(cli.run(['node', 'agentguard', 'validate', policyPath])).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Policy validation failed:'),
      );
    });
  });
});
