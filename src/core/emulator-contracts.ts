import { z } from "zod";

// Native positional arguments must not be interpreted as another option.
const nativeName = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^-\\/\0\r\n][^\\/\0\r\n]*$/)
  .refine(
    (value) => value !== "." && value !== "..",
    "Native names cannot be path segments",
  );
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const emulatorManageSchema = z
  .strictObject({
    action: z.enum([
      "list",
      "start",
      "stop",
      "create",
      "delete",
      "images",
      "image_install",
      "image_uninstall",
      "license_view",
      "license_accept",
    ]),
    name: nativeName.optional(),
    device_type: nativeName.optional(),
    os_version: nativeName.optional(),
    downloaded: z.boolean().optional(),
    license_sha256: sha256.optional(),
  })
  .superRefine((input, ctx) => {
    const allowed: string[] = ["action"];
    const required: string[] = [];
    if (["start", "stop", "create", "delete"].includes(input.action))
      required.push("name");
    if (["create", "image_install", "image_uninstall"].includes(input.action))
      required.push("device_type", "os_version");
    if (input.action === "images") allowed.push("device_type", "downloaded");
    if (input.action === "license_accept") required.push("license_sha256");
    allowed.push(...required);
    for (const [field, value] of Object.entries(input))
      if (value !== undefined && !allowed.includes(field))
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `Field is not used by ${input.action}`,
        });
    for (const field of required)
      if (!(field in input) || input[field as keyof typeof input] === undefined)
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `Field is required by ${input.action}`,
        });
  });

const ranges = {
  longitude: [-180, 180, 8],
  latitude: [-90, 90, 8],
  altitude: [-10000, 10000, 2],
  bearing: [0, 359.99, 2],
  light: [0, 100000, 1],
  humidity: [0, 100, 1],
  temperature: [-273.1, 100, 1],
  steps: [0, 100000, 0],
  heartrate: [0, 255, 0],
} as const;
export const emulatorScenarioSchema = z
  .strictObject({
    name: nativeName,
    action: z.enum([
      "shake",
      "power",
      "rotation",
      "volume",
      "folded_state",
      "battery",
      "battery_status",
      "gps",
      "outdoor_running",
      "outdoor_cycling",
      "driving_navigation",
      "sensor",
    ]),
    direction: z.enum(["left", "right", "up", "down"]).optional(),
    state: z
      .enum([
        "open",
        "vertical-open",
        "half-open",
        "close",
        "single",
        "double",
        "triple",
        "left-folded-right-half-folded",
        "left-half-folded-right-expanded",
        "left-expanded-right-folded",
        "left-half-folded-right-folded",
        "left-expanded-right-half-folded",
        "left-half-folded-right-half-folded",
      ])
      .optional(),
    value: z.number().optional(),
    key: z
      .enum([
        "longitude",
        "latitude",
        "altitude",
        "bearing",
        "light",
        "humidity",
        "temperature",
        "steps",
        "heartrate",
      ])
      .optional(),
  })
  .superRefine((input, ctx) => {
    const used: string[] = ["name", "action"];
    const issue = (field: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [field], message });
    if (input.action === "rotation" || input.action === "volume") {
      used.push("direction");
      if (
        !input.direction ||
        !(
          input.action === "rotation" ? ["left", "right"] : ["up", "down"]
        ).includes(input.direction)
      )
        issue("direction", "Choose a direction for this operation");
    } else if (input.action === "folded_state") {
      used.push("state");
      if (!input.state) issue("state", "A folding state is required");
    } else if (
      ["battery", "battery_status", "gps", "sensor"].includes(input.action)
    ) {
      used.push("value");
      let range: readonly [number, number, number] | undefined;
      if (input.action === "battery") range = [0, 100, 0];
      else if (input.action === "battery_status") range = [0, 1, 0];
      else {
        used.push("key");
        const keys =
          input.action === "gps"
            ? ["longitude", "latitude", "altitude", "bearing"]
            : ["light", "humidity", "temperature", "steps", "heartrate"];
        if (!input.key || !keys.includes(input.key))
          issue("key", "Choose a key for this operation");
        else range = ranges[input.key];
      }
      if (input.value === undefined)
        issue("value", "A numeric value is required");
      else if (range) {
        const [min, max, places] = range;
        if (
          input.value < min ||
          input.value > max ||
          Number(input.value.toFixed(places)) !== input.value
        )
          issue(
            "value",
            `Value must be in [${min}, ${max}] with at most ${places} decimal places`,
          );
      }
    }
    for (const [field, value] of Object.entries(input))
      if (value !== undefined && !used.includes(field))
        issue(field, `Field is not used by ${input.action}`);
  });
