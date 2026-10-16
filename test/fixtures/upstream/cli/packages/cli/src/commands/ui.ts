import { Command } from 'commander';

export const tapCommand = new Command('tap')
  .argument('[x]', 'X')
  .option('--id <id>', 'Node id');

const uiCommand = new Command('ui').description('UI');
export const systemCommands: Command[] = [
  new Command('wake').option('--device <id>', 'Target'),
  new Command('timezone').argument('[timezone]', 'Timezone'),
];
for (const cmd of systemCommands) {
  uiCommand.addCommand(cmd);
}
uiCommand.addCommand(tapCommand);
uiCommand.addCommand(
  new Command('shot')
    .option('--display <id>', 'Display')
);

export default uiCommand;
