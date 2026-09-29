import { program } from 'commander';
import emulatorCommand from './commands/emulator.js';
import uiCommand from './commands/ui.js';

program.addCommand(emulatorCommand);
program.addCommand(uiCommand);
