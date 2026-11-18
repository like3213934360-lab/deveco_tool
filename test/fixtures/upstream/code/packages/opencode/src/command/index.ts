export const Default = {
  ANALYZE: "analyze",
  UNREGISTERED: "unused-default",
} as const;

const commands: Record<string, { name: string }> = {};
commands[Default.ANALYZE] = { name: Default.ANALYZE };
