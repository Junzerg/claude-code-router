import { Command } from 'commander';
import createPoolAddCommand from '../commands/pool-add';
import createPoolRemoveCommand from '../commands/pool-remove';
import createPoolListCommand from '../commands/pool-list';
import createPoolStatusCommand from '../commands/pool-status';
import createPoolSetStatusCommand from '../commands/pool-set-status';
import createPoolBindingCommand from '../commands/pool-binding';

/**
 * Create the pool command with all subcommands
 */
export async function handlePoolCommand(args: string[]): Promise<void> {
  const poolCommand = new Command('pool')
    .description('Manage Z.ai Coding Plan account pool')
    .addCommand(createPoolAddCommand())
    .addCommand(createPoolRemoveCommand())
    .addCommand(createPoolListCommand())
    .addCommand(createPoolStatusCommand())
    .addCommand(createPoolSetStatusCommand())
    .addCommand(createPoolBindingCommand());

  // Parse arguments and execute (args already exclude 'pool')
  await poolCommand.parseAsync(['node', 'cli', ...args]);
}
