function registerSubcommands(command: Command): void {
  for (const [name, label] of [['read', 'Read'], ['export', 'Export']]) {
    const entry = command.command(name).description(label);
    if (name === 'export') entry.option('--out <path>');
  }
  command.command('host').command('list').option('--long');
}

export function createSkillsCommand(source = new SourceAdapter()): Command {
  const command = new Command('skills');
  registerSubcommands(command);
  return command;
}
