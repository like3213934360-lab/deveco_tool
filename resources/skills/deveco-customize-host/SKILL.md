---
name: deveco-customize-host
description: Configure a selected AI client's HarmonyOS MCP connection and project instructions using its supported interfaces and a persistent MCP workflow.
---

Start skill_workflow kind=customize with the existing project and original configuration objective. Read the current client's supported schema or official documentation. Record the minimal configuration change, validation and recovery in notes.md. Preserve unrelated configuration, credentials and the user's model choice.

All HarmonyOS knowledge and Skills are already bundled in this MCP. Read them through skill_manage and execute the indicated builtin workflows through skill_workflow and workflow_run. Do not create client Skill directories, copy SKILL.md files, or require a client-specific Skill loader. See [client integration](references/customization.md).

Use the client's authorized configuration editing capabilities only for a requested change. write uses expected_revision to preserve concurrent updates; publish writes a selected document to a new file. Follow planning, implementing, verifying and completed, recording the actual observations. MCP workflow state does not change the client's permissions, model or internal modes. If a client feature is unavailable, preserve the draft and state the missing capability; do not invent an API or execute arbitrary upstream runtime commands.
