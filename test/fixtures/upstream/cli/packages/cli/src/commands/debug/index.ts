const debugCommand = new Command('debug');
debugCommand.command('attach').option('--pid <n>');
export default debugCommand;
