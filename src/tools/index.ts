import type { ToolDef } from "../registry.js";
import { authTool, codeTool, deviceTool, diagnoseTool, doctorTool, jobTool, knowledgeTool, projectTool, runTool, skillsTool, uiFlowTool, uiTool } from "./core.js";
import { emulatorTool, hotReloadTool, signTool } from "./optional.js";

/** Default: 12 core tools. Optional groups via DEVECO_TOOL_GROUPS=core,sign,emulator,hot_reload (or all). */
export const allTools: ToolDef[] = [
  doctorTool, projectTool, runTool, jobTool, codeTool, deviceTool, uiTool, uiFlowTool, diagnoseTool, knowledgeTool, skillsTool, authTool,
  signTool, emulatorTool, hotReloadTool,
] as ToolDef[];
