import { delay } from '../helpers/index.js';

export const mockTools = {
  simpleFunction: (x: number, y: number) => x + y,

  asyncFunction: async (data: { message: string }) => {
    await delay(10);
    return { success: true, echo: data.message };
  },

  databaseRead: async (query: { table: string }) => {
    return { rows: [], table: query.table };
  },

  databaseDelete: async (params: { table: string; id: string }) => {
    return { deleted: true, ...params };
  },

  financialTransaction: async (params: { amount: number; recipient: string; category: string }) => {
    return { transactionId: 'tx-123', ...params };
  },

  errorFunction: async () => {
    throw new Error('Tool execution failed');
  },
};
