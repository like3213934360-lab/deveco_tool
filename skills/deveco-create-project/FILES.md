# Whitelist of files to include in skill_files for deveco-create-project
# Lines starting with # are comments; empty lines are ignored
# @note lines add informational annotations to skill_files

scripts/detect-sdk.ts
scripts/detect-sdk.mjs
scripts/copy-template.ts
scripts/copy-template.mjs
.version
@note application/ (built-in project template directory — the script uses this automatically; do NOT manually copy files from here)
@note application/AGENT.md — template navigation file; Agent reads it first in Step 4 to know which files to read/skip; copied into generated projects where the agent reads it (committable to skill repo); git tracking of AGENT.md in generated projects is left to the user to manage
