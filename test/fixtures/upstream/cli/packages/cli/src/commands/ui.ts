import { Command } from 'commander';

export const tapCommand = new Command('tap')
  .argument('[x]', 'X')
  .option('--id <id>', 'Node id');

const uiCommand = new Command('ui').description('UI');
uiCommand.addCommand(tapCommand);
uiCommand.addCommand(
  new Command('shot')
    .option('--display <id>', 'Display')
);

export default uiCommand;
