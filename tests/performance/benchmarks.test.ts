import { describe, it, expect } from 'vitest';
import { AgentGuard } from '../../src/index.js';
import { createMockPolicy } from '../helpers/index.js';
import type { Policy } from '../../src/types.js';

describe('Performance Benchmarks', () => {
  const simplePolicy = createMockPolicy({
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

  const complexPolicy: Policy = {
    version: '1.0',
    name: 'Complex Policy',
    defaultAction: 'BLOCK',
    rules: Array.from({ length: 100 }, (_, i) => ({
      name: `rule-${i}`,
      priority: i,
      action: (i % 3 === 0 ? 'BLOCK' : i % 3 === 1 ? 'ALLOW' : 'REQUIRE_HUMAN_APPROVAL') as any,
      conditions: [
        { field: 'toolCall.toolName', operator: 'equals' as const, value: `tool-${i}` },
        { field: 'toolCall.parameters.value', operator: 'gt' as const, value: i * 10 },
      ],
    })),
  };

  it('should perform simple policy evaluation efficiently', async () => {
    const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('test', (x: number) => x * 2);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await tool(42);
    }
    const end = performance.now();

    const duration = end - start;
    console.log(`Simple policy evaluation (100 iterations): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
  });

  it('should perform complex policy evaluation efficiently', async () => {
    const guard = new AgentGuard({ policy: complexPolicy, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('tool-49', (params: { value: number }) => params.value * 2);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await tool({ value: 500 }); // Use 500 which is > 490 (49 * 10) to satisfy the policy condition
    }
    const end = performance.now();

    const duration = end - start;
    console.log(`Complex policy evaluation (100 iterations): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(2000); // Should complete in less than 2 seconds
  });

  it('should handle worst-case evaluation efficiently', async () => {
    const guard = new AgentGuard({ policy: complexPolicy, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('non-existent-tool', (x: number) => x * 2);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      try {
        await tool(42);
      } catch (error) {
        // Expected block
      }
    }
    const end = performance.now();

    const duration = end - start;
    console.log(`Worst-case evaluation (100 iterations): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(2000); // Should complete in less than 2 seconds
  });

  it('should handle concurrent tool calls efficiently', async () => {
    const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
    await guard.initialize();

    const tool = guard.protect('test', async (x: number) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return x * 2;
    });

    const start = performance.now();
    await Promise.all(Array.from({ length: 10 }, (_, i) => tool(i)));
    const end = performance.now();

    const duration = end - start;
    console.log(`Concurrent tool calls (10 concurrent): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(5000); // Should complete in less than 5 seconds
  });

  describe('operator performance', () => {
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

        const tool = guard.protect('test', (data: { value: any }) => 'result');

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          try {
            await tool({ value: 'test-string-end' });
          } catch (error) {
            // May be blocked
          }
        }
        const end = performance.now();

        results[testCase.operator] = end - start;
      }

      console.log('Operator performance (1000 iterations):', results);

      Object.values(results).forEach(time => {
        expect(time).toBeLessThan(100);
      });
    });
  });

  describe('memory usage', () => {
    it('should not leak memory with repeated calls', async () => {
      const guard = new AgentGuard({ policy: simplePolicy, enableLogging: false });
      await guard.initialize();

      const tool = guard.protect('test', (data: any[]) => data.length);

      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 10000; i++) {
        await tool(new Array(100).fill(i));
      }

      if (global.gc) global.gc();

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});
