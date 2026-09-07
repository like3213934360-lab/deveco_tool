import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  request_id?: string;
  run_id?: string;
  node?: string;
}
const trace = new AsyncLocalStorage<TraceContext>();
export const currentTrace = () => trace.getStore() ?? {};
export function withTrace<T>(fields: TraceContext, task: () => T): T {
  return trace.run({ ...currentTrace(), ...fields }, task);
}
