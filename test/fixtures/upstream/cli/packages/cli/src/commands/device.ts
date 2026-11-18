import { Command } from 'commander';

const deviceCommand = new Command('device');
const playbackCommand = new Command('playback');
deviceCommand.addCommand(playbackCommand);
const PLAYBACK_CONTROLS = [{ name: 'play' }, { name: 'pause' }] as const;
for (const { name } of PLAYBACK_CONTROLS) {
  playbackCommand.command(name).option('--device <target>').action(() => {
    playbackCommand.command('not-a-registration');
  });
}

export default deviceCommand;
