import { z } from "zod";

const text = z.string().nullable(),
  flag = z.boolean().nullable();
export const uiNodesSchema = z
  .array(
    z.object({
      parent: z.number().int().nonnegative().nullable(),
      depth: z.number().int().nonnegative(),
      id: text,
      type: z.string(),
      key: text,
      text: z.string(),
      rect: z
        .object({
          x1: z.number().finite(),
          x2: z.number().finite(),
          y1: z.number().finite(),
          y2: z.number().finite(),
        })
        .nullable(),
      checked: flag,
      selected: flag,
      enabled: flag,
      clickable: flag,
      visible: flag,
      value: z.union([z.string(), z.number().finite()]).nullable(),
      displayId: text,
      windowId: text,
      bundleName: text,
      abilityName: text,
      focused: flag,
      checkable: flag,
      pagePath: text,
    }),
  )
  .min(1)
  .max(100000);
