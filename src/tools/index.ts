import type { ToolDef } from "../registry.js";
import { authTool, codeTool, deviceTool, diagnoseTool, doctorTool, jobTool, knowledgeTool, projectTool, runTool, skillsTool, uiFlowTool, uiTool } from "./core.js";
import { emulatorTool, hotReloadTool, signTool } from "./extra.js";

/** All 15 tools are always exposed; their domain code loads lazily on first call. */
export const allTools: ToolDef[] = [
  doctorTool, projectTool, runTool, jobTool, codeTool, deviceTool, uiTool, uiFlowTool, diagnoseTool, knowledgeTool, skillsTool, authTool,
  signTool, emulatorTool, hotReloadTool,
] as ToolDef[];
