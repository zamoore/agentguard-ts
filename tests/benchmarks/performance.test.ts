import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bench } from 'vitest';
import { AgentGuard } from '../../src/lib/agentguard.js';
import { createMockPolicy } from '../helpers/index.js';
import type { Policy, PolicyRule } from '../../src/types.js';

describe('Performance Benchmarks', () => {
  let guard: AgentGuard;
  let simplePolicy: Policy;
  let complexPolicy: Policy;

  beforeEach(async () => {
    simplePolicy = createMockPolicy({
      defaultAction: 'ALLOW',
      rules: [
        {
          name: 'simple-rule',
          action: 'BLOCK',
          conditions: [
            {
              field: 'toolCall.toolName',
              operator: 'equals',
              value: 'blocked',
            },
          ],
        },
      ],
    });

    // Create a policy with many rules
    const rules: PolicyRule[] = [];
    for (let i = 0; i < 100; i++) {
      rules.push({
        name: `rule-${i}`,
        priority: i,
        action: i % 3 === 0 ? 'BLOCK' : i % 3 === 1 ? 'ALLOW' : 'REQUIRE_HUMAN_APPROVAL',
        conditions: [
          {
            field: 'toolCall.toolName',
            operator: 'equals' as const,
            value: `tool-${i}`,
          },
          {
            field: 'toolCall.parameters.value',
            operator: 'gt' as const,
            value: i * 10,
          },
        ],
      });
    }

    complexPolicy = createMockPolicy({
      defaultAction: 'BLOCK',
      rules,
    });

    // Initialize shared guard with simple policy
    guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
    await guard.initialize();
  });

  afterEach(() => {
    // Clean up guard instance
    guard = null as any;
  });

  describe('Policy Evaluation Performance', () => {
    bench(
      'simple policy evaluation',
      async () => {
        const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
        await guard.initialize();

        const tool = guard.protect('test', (x: number) => x * 2);
        await tool(42);
      },
      { time: 1000 },
    );

    bench(
      'complex policy evaluation (100 rules)',
      async () => {
        const guard = new AgentGuard({ policy: complexPolicy, enableLogging: false });
        await guard.initialize();

        const tool = guard.protect('tool-50', (x: number) => x * 2);
        await tool(42);
      },
      { time: 1000 },
    );

    bench(
      'worst-case policy evaluation (no matching rules)',
      async () => {
        const guard = new AgentGuard({ policy: complexPolicy, enableLogging: false });
        await guard.initialize();

        const tool = guard.protect('non-existent-tool', (x: number) => x * 2);
        try {
          await tool(42);
        } catch (error) {
          // Expected block
        }
      },
      { time: 1000 },
    );
  });

  describe('Tool Wrapping Performance', () => {
    bench(
      'wrapping overhead - simple function',
      async () => {
        const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
        await guard.initialize();

        const fn = (x: number, y: number) => x + y;
        guard.protect('add', fn);
      },
      { time: 1000 },
    );

    bench(
      'wrapping overhead - complex function',
      async () => {
        const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
        await guard.initialize();

        const fn = async (params: {
          data: any[];
          options: { filter?: (x: any) => boolean; sort?: string };
          metadata?: Record<string, any>;
        }) => {
          const filtered = params.options.filter
            ? params.data.filter(params.options.filter)
            : params.data;
          return { result: filtered, count: filtered.length };
        };

        guard.protect('complex', fn);
      },
      { time: 1000 },
    );
  });

  describe('Condition Evaluation Performance', () => {
    it('should benchmark different operators', async () => {
      const testCases = [
        { operator: 'equals', value: 'test' },
        { operator: 'contains', value: 'partial' },
        { operator: 'regex', value: '^test.*end$' },
        { operator: 'in', value: ['a', 'b', 'c', 'd', 'e'] },
        { operator: 'gt', value: 100 },
      ];

      const results: Record<string, number> = {};

      for (const testCase of testCases) {
        const policy = createMockPolicy({
          defaultAction: 'ALLOW',
          rules: [
            {
              name: 'test-rule',
              action: 'BLOCK',
              conditions: [
                {
                  field: 'toolCall.parameters.value',
                  operator: testCase.operator as any,
                  value: testCase.value,
                },
              ],
            },
          ],
        });

        const guard = new AgentGuard({ policy, enableLogging: false });
        await guard.initialize();

        const tool = guard.protect('test', (value: string) => 'result');

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          try {
            await tool('test-string-end');
          } catch (error) {
            // May be blocked
          }
        }
        const end = performance.now();

        results[testCase.operator] = end - start;
      }

      // Log results for comparison
      console.log('Operator performance (1000 iterations):', results);

      // All operators should complete in reasonable time
      Object.values(results).forEach(time => {
        expect(time).toBeLessThan(100); // Less than 100ms for 1000 iterations
      });
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory with repeated tool calls', async () => {
      const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
      await guard.initialize();

      const tool = guard.protect('test', (data: any[]) => data.length);

      const initialMemory = process.memoryUsage().heapUsed;

      // Make many calls
      for (let i = 0; i < 10000; i++) {
        await tool(new Array(100).fill(i));
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Concurrent Operations', () => {
    bench(
      'concurrent tool calls',
      async () => {
        const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
        await guard.initialize();

        const tool = guard.protect('test', async (x: number) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return x * 2;
        });

        const promises: Promise<number>[] = [];
        for (let i = 0; i < 100; i++) {
          promises.push(tool(i));
        }

        await Promise.all(promises);
      },
      { time: 2000 },
    );
  });

  describe('Policy Loading Performance', () => {
    bench(
      'policy initialization',
      async () => {
        const guard = new AgentGuard({ policy: complexPolicy, enableLogging: false });
        await guard.initialize();
      },
      { time: 1000 },
    );

    it('should measure policy reload performance', async () => {
      const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
      await guard.initialize();

      // Can't truly reload from in-memory policy, but we can reinitialize
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const newGuard = new AgentGuard({ policy: complexPolicy, enableLogging: false });
        await newGuard.initialize();
      }
      const end = performance.now();

      const avgTime = (end - start) / 100;
      console.log(`Average policy initialization time: ${avgTime.toFixed(2)}ms`);

      expect(avgTime).toBeLessThan(10); // Should be fast
    });
  });

  describe('Guard Instance Reuse Performance', () => {
    bench(
      'shared guard instance - multiple tool wrappings',
      async () => {
        // Reuse the shared guard instance
        const tool1 = guard.protect('tool1', (x: number) => x * 2);
        const tool2 = guard.protect('tool2', (x: number) => x + 1);
        const tool3 = guard.protect('tool3', (x: number) => x / 2);

        await tool1(42);
        await tool2(42);
        await tool3(42);
      },
      { time: 1000 },
    );

    bench(
      'new guard instances vs shared instance',
      async () => {
        // Create new guard for comparison
        const newGuard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
        await newGuard.initialize();

        const tool = newGuard.protect('test', (x: number) => x * 2);
        await tool(42);
      },
      { time: 1000 },
    );

    it('should compare performance: shared vs new guard instances', async () => {
      const iterations = 1000;

      // Test shared guard performance
      const sharedStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const tool = guard.protect(`shared-tool-${i}`, (x: number) => x * 2);
        await tool(42);
      }
      const sharedEnd = performance.now();
      const sharedTime = sharedEnd - sharedStart;

      // Test new guard instances performance
      const newStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const newGuard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
        await newGuard.initialize();
        const tool = newGuard.protect(`new-tool-${i}`, (x: number) => x * 2);
        await tool(42);
      }
      const newEnd = performance.now();
      const newTime = newEnd - newStart;

      console.log(`Shared guard: ${sharedTime.toFixed(2)}ms, New guards: ${newTime.toFixed(2)}ms`);
      console.log(`Performance ratio (new/shared): ${(newTime / sharedTime).toFixed(2)}x`);

      // Shared guard should be significantly faster
      expect(sharedTime).toBeLessThan(newTime);
      // New instances should take at least 2x longer due to initialization overhead
      expect(newTime / sharedTime).toBeGreaterThan(2);
    });

    it('should test guard state isolation between tool calls', async () => {
      const tool1 = guard.protect('state-test-1', (x: number) => x * 2);
      const tool2 = guard.protect('state-test-2', (x: number) => x * 3);

      const results: number[] = [];
      const iterations = 100;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        // Interleave calls to test state isolation
        results.push(await tool1(i));
        results.push(await tool2(i));
      }
      const end = performance.now();

      const avgTime = (end - start) / (iterations * 2);
      console.log(`Average state isolation time per call: ${avgTime.toFixed(3)}ms`);

      // Verify results are correct (state wasn't corrupted)
      expect(results[0]).toBe(0); // tool1(0) = 0 * 2
      expect(results[1]).toBe(0); // tool2(0) = 0 * 3
      expect(results[2]).toBe(2); // tool1(1) = 1 * 2
      expect(results[3]).toBe(3); // tool2(1) = 1 * 3

      // Performance should be reasonable
      expect(avgTime).toBeLessThan(1); // Less than 1ms per call
    });
  });
});
