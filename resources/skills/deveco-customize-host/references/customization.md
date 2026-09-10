# Client integration through MCP

The MCP package contains its knowledge, Skills and workflow definitions. A client discovers tools, calls skill_workflow catalog/start, follows the current-phase guidance, and returns applicable results through MCP. No Skill files are installed on the client. Relative Skill references are read with skill_manage action=read, name and file; knowledge pages are read with harmony_knowledge. All workflow state and evidence remain in the MCP state store across reconnects.

The client supplies language reasoning, file reading/editing for code changes and image understanding for visual requirements. Native SDK, build, device, UI, logging and verification operations go through the MCP's typed tools and deterministic workflows. A client lacking a required capability must report that boundary; the workflow remains incomplete. Do not assume a particular product's internal mode, agent or plugin API exists in another client.

When the user asks to configure a client, inspect that client's current supported schema, preserve unrelated settings and credentials, and use the repository maintenance workflow for MCP package upgrades and rollback. Configuration written, independent stdio verification and the running client's actual loaded version are different observations. Do not infer successful loading from a file edit.
