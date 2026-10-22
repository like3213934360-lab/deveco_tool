import { z } from "zod";

/** Shared selector contract for tool arguments and persisted UI flows. */
export const selectorSchema = z.object({
  xpath: z.string().min(1).max(2048).optional().describe("XPath 1.0"),
  regex: z.record(z.string().regex(/^(text|description|id|key|type|bundle|window|page)$/), z.string().min(1).max(512)).optional(),
  regex_flags: z.string().max(4).optional().describe("i/m/s/u; default iu"),
  text: z.string().optional().describe("Contains"),
  exact: z.boolean().optional(),
  text_match: z.enum(["contains", "exact", "prefix", "suffix"]).optional(),
  description: z.string().optional(),
  focused: z.boolean().optional(),
  scrollable: z.boolean().optional(),
  long_clickable: z.boolean().optional(),
  checkable: z.boolean().optional(),
  within: z.string().optional().describe("Ancestor id/key"),
  key: z.string().optional().describe("ArkUI .id('...')"),
  type: z.string().optional(),
  id: z.string().optional(),
  bundle: z.string().optional(),
  clickable: z.boolean().optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  enabled: z.boolean().optional(),
  index: z.number().int().optional().describe("Zero-based; -1=last"),
}).strict().meta({ id: "Selector" }); // emitted once per tool as $defs/Selector
