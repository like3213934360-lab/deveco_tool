import { z } from 'zod';

class Server {
  private getPositionFeatures(): Array<{ name: string; feature: 'hover' | 'definition' }> {
    return [
      { name: 'hover', feature: 'hover' },
      { name: 'definition', feature: 'definition' },
    ];
  }

  register() {
    const lspPositionSchema = z.object({
      file: z.string().describe('File'),
      line: z.number().describe('Line'),
    });
    for (const { name, feature } of this.getPositionFeatures()) {
      this.toolRouter.add({ name, description: feature, inputSchema: lspPositionSchema }, async () => undefined);
    }
    this.toolRouter.add(
      {
        name: 'restart',
        description: 'Restart',
        inputSchema: z.object({
          target: z
            .enum(['arkts', 'cpp', 'all'])
            .default('all'),
          force: z.boolean().optional(),
        }),
      },
      async () => undefined,
    );
  }
}
