import { z } from "zod";

export const selectorSchema = z.strictObject({
  text: z.string().optional(),
  textMode: z.enum(["contains", "exact"]).default("contains"),
  key: z.string().optional(),
  type: z.string().optional(),
  node_id: z.string().optional(),
  window_id: z.string().optional(),
  bundle_name: z.string().min(1).optional(),
  displayId: z.union([z.string(), z.number()]).optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  enabled: z.boolean().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  clickableOnly: z.boolean().default(false),
  onScreenOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(20),
});
export type Selector = z.infer<typeof selectorSchema>;

export const meaningfulSelector = selectorSchema.refine(
  (s) => !!(s.key || s.text || s.type || s.node_id),
  "Selector needs key, text, type or node_id",
);
export const assertionSchema = z
  .strictObject({
    visible: meaningfulSelector.optional(),
    hidden: meaningfulSelector.optional(),
    timeoutMs: z.number().int().min(100).max(600000).default(5000),
    alternates: z.array(meaningfulSelector).max(5).optional(),
  })
  .refine(
    (input) => (input.visible !== undefined) !== (input.hidden !== undefined),
    "Provide exactly one visible or hidden assertion",
  );

/** A named application owns the observation; selector scoping cannot escape it. */
export const nativeOutcomeSchema = z.strictObject({
  bundle_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/),
  assert: assertionSchema,
}).superRefine((input, ctx) => {
  for (const selector of [input.assert.visible, input.assert.hidden, ...(input.assert.alternates ?? [])]) {
    if (selector?.bundle_name && selector.bundle_name !== input.bundle_name)
      ctx.addIssue({ code: "custom", path: ["assert"], message: "All selectors must belong to the observation application" });
  }
});
