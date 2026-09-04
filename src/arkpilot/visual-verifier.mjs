import crypto from "node:crypto";
import { uiObserve, uiSnapshot } from "../device-ui.mjs";
import { flowError } from "./domain.mjs";

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const snapshots = new Map();

function prune() {
  const now = Date.now();
  for (const [id, snapshot] of snapshots) {
    if (now - snapshot.createdAt > SNAPSHOT_TTL_MS) snapshots.delete(id);
  }
}

function remember(report) {
  prune();
  const id = crypto.randomUUID();
  snapshots.set(id, {
    id,
    createdAt: Date.now(),
    deviceId: report.deviceId,
    frameSignature: report.frameSignature,
    structureSignature: report.structureSignature ?? null,
  });
  return id;
}

function selectorInput(input) {
  return input.selector ?? input.success_selector ?? null;
}

/**
 * Visual verification is deliberately split in two: deterministic checks happen here, while an
 * MCP host with vision can inspect the returned image for appearance requirements. No screenshot
 * path is persisted in a project and the underlying capture is deleted after it is inlined.
 */
export async function verifyUi(input = {}) {
  const action = input.action ?? "capture";
  if (!["capture", "assert", "compare"].includes(action)) {
    throw flowError(`Unknown verify_ui action: ${action}`, "VERIFY_UI_ACTION_INVALID");
  }
  if (action === "assert" && !selectorInput(input)) {
    throw flowError(
      "verify_ui action=assert requires a semantic selector",
      "VERIFY_UI_SELECTOR_REQUIRED",
      "Use capture with visual_prompt for host visual inspection, or pass selector for a deterministic assertion.",
    );
  }
  if (action === "compare") {
    prune();
    const baseline = snapshots.get(String(input.baseline_id ?? ""));
    if (!baseline) {
      throw flowError("Visual baseline is missing or expired", "VERIFY_UI_BASELINE_NOT_FOUND",
        "Capture a new baseline; in-memory baselines expire after ten minutes and never persist in the project.");
    }
    const report = await uiSnapshot({
      hvd: input.hvd ?? baseline.deviceId,
      width: input.width,
      timeoutMs: input.timeoutMs,
      ifChangedFrom: baseline.frameSignature,
      inline: input.inline,
    });
    const expectation = input.expect ?? "changed";
    const unchanged = report.frameSignature === baseline.frameSignature;
    const passed = expectation === "unchanged" ? unchanged : !unchanged;
    const snapshotId = remember(report);
    return {
      ...report,
      verification: {
        mode: "pixel-exact-frame-signature",
        expectation,
        passed,
        baselineId: baseline.id,
        snapshotId,
        caveat: "Animated pixels make exact frame signatures change; use a semantic selector or host visual inspection for animated screens.",
      },
    };
  }

  const selector = selectorInput(input);
  const report = selector
    ? await uiObserve({
      ...selector,
      hvd: input.hvd,
      width: input.width,
      timeoutMs: input.timeoutMs,
      inline: input.inline,
      limit: 20,
    })
    : await uiSnapshot({
      hvd: input.hvd,
      width: input.width,
      timeoutMs: input.timeoutMs,
      inline: input.inline,
    });
  const snapshotId = remember(report);
  const wantedVisible = input.success_state !== "hidden";
  const passed = selector ? ((report.matchCount > 0) === wantedVisible) : null;
  return {
    ...report,
    verification: {
      mode: selector ? "semantic-and-visual" : "host-visual",
      snapshotId,
      passed,
      hostVisionRequired: !selector || Boolean(input.visual_prompt),
      ...(input.visual_prompt ? { visualPrompt: input.visual_prompt } : {}),
      screenshotsPersisted: false,
      expiresAfterMs: SNAPSHOT_TTL_MS,
    },
  };
}

export function closeVisualVerifier() {
  snapshots.clear();
}

export const visualVerifierInternals = { snapshots, prune };
