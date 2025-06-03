#!/usr/bin/env node

/**
 * AgentGuard CLI Tool
 *
 * Provides commands to initialize, validate, and manage AgentGuard policies
 */

import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { AgentGuard, PolicyLoader, Logger } from './index.js';

interface CLICommand {
  name: string;
  description: string;
  handler: (args: string[]) => Promise<void>;
}

class AgentGuardCLI {
  private commands: CLICommand[] = [
    {
      name: 'init',
      description: 'Initialize a new AgentGuard policy file',
      handler: this.initCommand.bind(this),
    },
    {
      name: 'validate',
      description: 'Validate a policy file',
      handler: this.validateCommand.bind(this),
    },
    {
      name: 'test',
      description: 'Test a tool call against a policy',
      handler: this.testCommand.bind(this),
    },
    {
      name: 'help',
      description: 'Show help information',
      handler: this.helpCommand.bind(this),
    },
  ];

  async run(args: string[]): Promise<void> {
    const [command, ...commandArgs] = args.slice(2); // Remove 'node' and script name

    if (!command || command === 'help') {
      await this.helpCommand([]);
      return;
    }

    const cmd = this.commands.find(c => c.name === command);
    if (!cmd) {
      console.error(`Unknown command: ${command}`);
      console.error('Run "agentguard help" for available commands');
      process.exit(1);
    }

    try {
      await cmd.handler(commandArgs);
    } catch (error) {
      console.error(
        `Error running command "${command}":`,
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
  }

  private async initCommand(args: string[]): Promise<void> {
    const [policyPath = 'agentguard-policy.yaml'] = args;

    if (existsSync(policyPath)) {
      console.error(`Policy file already exists: ${policyPath}`);
      console.log('Use --force to overwrite');
      return;
    }

    const samplePolicy = PolicyLoader.generateSamplePolicy();
    await writeFile(policyPath, samplePolicy, 'utf-8');

    console.log(`✅ Created AgentGuard policy file: ${policyPath}`);
    console.log('\nNext steps:');
    console.log('1. Edit the policy file to match your security requirements');
    console.log('2. Configure your webhook URL for human approval workflows');
    console.log('3. Test your policy with: agentguard test');
    console.log('\nExample usage in your code:');
    console.log(`
import { createAgentGuard } from '@zamoore/agentguard-ts';

const guard = createAgentGuard({ policyPath: '${policyPath}' });
await guard.initialize();

const protectedTool = guard.protect('tool_name', yourToolFunction);
`);
  }

  private async validateCommand(args: string[]): Promise<void> {
    const [policyPath = 'agentguard-policy.yaml'] = args;

    if (!existsSync(policyPath)) {
      console.error(`Policy file not found: ${policyPath}`);
      console.log('Run "agentguard init" to create a new policy file');
      return;
    }

    console.log(`Validating policy file: ${policyPath}`);

    try {
      const loader = new PolicyLoader(new Logger());
      const policy = await loader.loadPolicy(policyPath);

      console.log('✅ Policy validation successful!');
      console.log(`\nPolicy summary:`);
      console.log(`  Name: ${policy.name}`);
      console.log(`  Version: ${policy.version}`);
      console.log(`  Default Action: ${policy.defaultAction}`);
      console.log(`  Rules: ${policy.rules.length}`);

      if (policy.webhook) {
        console.log(`  Webhook: ${policy.webhook.url}`);
      }

      console.log('\nRules:');
      policy.rules.forEach((rule, index) => {
        console.log(
          `  ${index + 1}. ${rule.name} (${rule.action}) - Priority: ${rule.priority || 0}`,
        );
        console.log(`     Conditions: ${rule.conditions.length}`);
      });
    } catch (error) {
      console.error('❌ Policy validation failed:');
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  private async testCommand(args: string[]): Promise<void> {
    const [policyPath = 'agentguard-policy.yaml', toolName, ...paramArgs] = args;

    if (!toolName) {
      console.error('Usage: agentguard test [policy-path] <tool-name> [key=value...]');
      console.log('\nExample:');
      console.log('  agentguard test database_delete table=users id=123');
      console.log('  agentguard test send_payment amount=1000 recipient=vendor@example.com');
      return;
    }

    if (!existsSync(policyPath)) {
      console.error(`Policy file not found: ${policyPath}`);
      return;
    }

    // Parse parameters
    const parameters: Record<string, unknown> = {};
    for (const param of paramArgs) {
      const [key, value] = param.split('=', 2);
      if (key && value !== undefined) {
        // Try to parse as JSON, fallback to string
        try {
          parameters[key] = JSON.parse(value);
        } catch {
          parameters[key] = value;
        }
      }
    }

    console.log(`Testing tool call against policy: ${policyPath}`);
    console.log(`Tool: ${toolName}`);
    console.log(`Parameters:`, parameters);
    console.log('');

    try {
      const guard = new AgentGuard({ policyPath });
      await guard.initialize();

      // Create a test tool call
      const toolCall = {
        toolName,
        parameters,
        agentId: 'test-agent',
        sessionId: 'test-session',
        metadata: { source: 'cli-test' },
      };

      // Use reflection to access private method for testing
      const evaluateMethod = (guard as any).evaluateToolCall.bind(guard);
      const result = await evaluateMethod(toolCall);

      console.log('🔍 Policy Evaluation Result:');
      console.log(`  Decision: ${result.decision}`);
      console.log(`  Reason: ${result.reason}`);

      if (result.rule) {
        console.log(`  Matched Rule: ${result.rule.name}`);
        console.log(`  Rule Priority: ${result.rule.priority || 0}`);
      }

      if (result.approvalRequestId) {
        console.log(`  Approval Request ID: ${result.approvalRequestId}`);
      }

      // Show what would happen
      switch (result.decision) {
        case 'ALLOW':
          console.log('\n✅ This tool call would be ALLOWED');
          break;
        case 'BLOCK':
          console.log('\n❌ This tool call would be BLOCKED');
          break;
        case 'REQUIRE_HUMAN_APPROVAL':
          console.log('\n⏳ This tool call would REQUIRE HUMAN APPROVAL');
          console.log('   A webhook would be sent to your configured endpoint');
          break;
      }
    } catch (error) {
      console.error('❌ Test failed:');
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  private async helpCommand(args: string[]): Promise<void> {
    console.log('AgentGuard CLI - Security toolkit for AI agents');
    console.log('');
    console.log('Usage: agentguard <command> [options]');
    console.log('');
    console.log('Commands:');

    this.commands.forEach(cmd => {
      console.log(`  ${cmd.name.padEnd(12)} ${cmd.description}`);
    });

    console.log('');
    console.log('Examples:');
    console.log('  agentguard init                          # Create a new policy file');
    console.log('  agentguard init my-policy.yaml           # Create policy with custom name');
    console.log('  agentguard validate                      # Validate default policy file');
    console.log('  agentguard validate my-policy.yaml       # Validate specific policy file');
    console.log('  agentguard test database_delete id=123   # Test a tool call');
    console.log('');
    console.log('For more information, visit: https://github.com/your-org/agentguard');
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new AgentGuardCLI();
  cli.run(process.argv).catch(error => {
    console.error('CLI error:', error);
    process.exit(1);
  });
}

export { AgentGuardCLI };
