# Whitelist of files to include in skill_files for deveco-create-project
# Lines starting with # are comments; empty lines are ignored
# @note lines add informational annotations to skill_files

scripts/detect-sdk.ts
scripts/detect-sdk.mjs
scripts/copy-template.ts
scripts/copy-template.mjs
.version
@note This skill carries no project template. copy-template.mjs invokes the local DevEco CLI's `create` subcommand, which generates the project itself.
