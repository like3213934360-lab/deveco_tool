import { Argument, Command, Option } from 'commander';

const MODES = ['fast', 'slow'] as const;
const DEVICE_FLAG = ['--device <serial>', 'Target device'] as const;

function deviceTypeOption(): Option {
  return new Option('--device-type <type>', 'Device type').choices(['phone', 'tablet']);
}

const emulatorCommand = new Command('emulator').description('Emulators');

const imageCommand = new Command('image').description('Images');
imageCommand
  .command('download')
  .addOption(deviceTypeOption())
  .option('--force', 'Re-download');
emulatorCommand.addCommand(imageCommand);

emulatorCommand
  .command('rotate')
  .addOption(new Option('--target <name>', 'Emulator').makeOptionMandatory())
  .addArgument(new Argument('<direction>').choices(['left', 'right']));

emulatorCommand
  .command('start [names...]')
  .option(...DEVICE_FLAG)
  .addOption(new Option('--mode <mode>', 'Boot mode').choices(MODES));

const teamCommand = emulatorCommand
  .command('team')
  .description('Nested alias');

teamCommand
  .command('list')
  .option('--all', 'All');

export default emulatorCommand;
