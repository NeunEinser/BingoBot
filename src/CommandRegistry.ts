import { ApplicationCommandOptionChoiceData, AutocompleteInteraction, ChatInputCommandInteraction, Collection, MessageFlags, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import BingoBot, { BotContext } from './BingoBot';
import PingCommand from './discord_commands/ping';
import IntroCommand from './discord_commands/intro';
import ShutdownCommand from './discord_commands/shutdown';
import StreamerCommand from './discord_commands/streamer';
import WeekCommand from './discord_commands/week';
import SeedCommand from './discord_commands/seed';
import ScoreCommand from './discord_commands/score';
import BotConfig from './BotConfig';

export interface Command {
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>,
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<ApplicationCommandOptionChoiceData[] | undefined>,
}

export default class CommandRegistry {
	constructor(private readonly context: BotContext, private readonly config: BotConfig) {}

	public async registerCommands(): Promise<void> {
		const commandApi = this.context.discordClient.application!.commands

		const commandDefs: Record<string, { data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder, command: Command}> = {
			ping: { data: PingCommand.data, command: new PingCommand() },
			intro: { data: IntroCommand.data, command: new IntroCommand() },
			shutdown: { data: ShutdownCommand.data, command: new ShutdownCommand() },
			streamer: { data: StreamerCommand.data, command: new StreamerCommand(this.context) },
			week: { data: WeekCommand.data, command: new WeekCommand(this.context, this.config) },
			seed: { data: SeedCommand.data, command: new SeedCommand(this.context) },
			score: { data: ScoreCommand.data, command: new ScoreCommand(this.context) },
		}

		await commandApi.set(Object.values(commandDefs).map(d => d.data.toJSON()));

		this.context.discordClient.on('interactionCreate', async interaction => {
			try {
				if (interaction.isAutocomplete()) {
					const command = commandDefs[interaction.commandName]?.command;
					if (!command) {
						BingoBot.logger.error(`Could not find matching command definition for ${interaction.commandName}`);
						return;
					}

					if (command.autocomplete) {
						const completions = await command.autocomplete(interaction);
						if (completions) {
							await interaction.respond(completions);
						} else {
							interaction.respond([]);
						}
					} else {
						BingoBot.logger.warn(`Command ${interaction.commandName} does not have an autocomplete script defined.`);
					}
				}
				else if (interaction.isChatInputCommand()) {
					BingoBot.logger.info(`Received command ${interaction.commandName}\n${JSON.stringify(interaction.options.data)}`);
					
					const command = commandDefs[interaction.commandName]?.command;
					if (!command) {
						BingoBot.logger.error(`Could not find matching command definition for ${interaction.commandName}`);
						return;
					}

					await command.execute(interaction);
					if (!interaction.replied) {
						if (interaction.deferred) {
							interaction.editReply('Command executed successfully!')
						} else {
							interaction.reply({ content: 'Command executed successfully!', flags: MessageFlags.Ephemeral })
						}
					}
				}
			} catch (err) {
				try {
					BingoBot.logger.error(err);
					if(interaction.isCommand()) {
						if (interaction.replied || interaction.deferred) {
							await interaction.followUp("Command execution failed");
						} else {
							await interaction.reply("Command execution failed");
						}
					}
				} catch (_) {}
			}
		});
	}
}