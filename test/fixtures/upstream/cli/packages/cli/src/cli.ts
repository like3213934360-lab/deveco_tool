import { program } from 'commander';
import emulatorCommand from './commands/emulator.js';
import uiCommand from './commands/ui.js';
import debugCommand from './commands/debug/index.js';
import { createSkillsCommand } from './commands/skills.js';
import deviceCommand from './commands/device.js';

program.addCommand(emulatorCommand);
program.addCommand(uiCommand);
program.addCommand(debugCommand);
program.addCommand(createSkillsCommand(new SourceAdapter()));
program.addCommand(deviceCommand);
