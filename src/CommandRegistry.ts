import { ApplicationCommandOptionChoiceData, AutocompleteInteraction, ChatInputCommandInteraction, Collection, Events, MessageFlags, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import BingoBot, { BotContext } from './BingoBot';
import PingCommand from './discord_commands/ping';
import IntroCommand from './discord_commands/intro';
import ShutdownCommand from './discord_commands/shutdown';
import StreamerCommand from './discord_commands/streamer';
import WeekCommand from './discord_commands/week';
import SeedCommand from './discord_commands/seed';
import ScoreCommand from './discord_commands/score';
import BotConfig from './BotConfig';
import IgnCommand from './discord_commands/ign';
import RestartCommand from './discord_commands/restart';

export interface Command {
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>,
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<ApplicationCommandOptionChoiceData[] | undefined>,
}

export const SUBMIT_SCORE_ID = 'submit_seed_score'

export default class CommandRegistry {
	constructor(private readonly context: BotContext, private readonly config: BotConfig) {}

	public async registerCommands(): Promise<void> {
		const commandApi = this.context.discordClient.application!.commands

		const commandDefs = {
			ping: { data: PingCommand.data, command: new PingCommand() },
			intro: { data: IntroCommand.data, command: new IntroCommand() },
			shutdown: { data: ShutdownCommand.data, command: new ShutdownCommand() },
			restart: { data: RestartCommand.data, command: new RestartCommand() },
			streamer: { data: StreamerCommand.data, command: new StreamerCommand(this.context) },
			week: { data: WeekCommand.data, command: new WeekCommand(this.context, this.config) },
			seed: { data: SeedCommand.data, command: new SeedCommand(this.context, this.config) },
			ign: { data: IgnCommand.data, command: new IgnCommand(this.context, this.config) },
			score: { data: ScoreCommand.data, command: new ScoreCommand(this.context, this.config) },
		}

		const commandLookup: Record<string, { data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder, command: Command}>
			= commandDefs;

		await commandApi.set(Object.values(commandDefs).map(d => d.data.toJSON()));

		this.context.discordClient.on(Events.InteractionCreate, async interaction => {
			function logInteraction(type?: string, name?: string) {
				BingoBot.logger.info(`Received ${type ?? 'unknown'} interaction${name ? ' for ' + name : ''}\n${JSON.stringify(
					{ ...interaction },
					(key, value) => typeof value === 'bigint'
						? value.toString()
						: key === 'options'
							? { ...value, data: value.data }
							: value,
					4
				)}`);
			}

			try {
				if (interaction.isAutocomplete()) {
					logInteraction('autocomplete', interaction.commandName);

					const command = commandLookup[interaction.commandName]?.command;
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
				} else if (interaction.isChatInputCommand()) {
					logInteraction('command', interaction.commandName);
					const command = commandLookup[interaction.commandName]?.command;
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
				} else if (interaction.isModalSubmit()) {
					logInteraction('modal submit', interaction.customId);

					if (interaction.customId === 'ign') {
						await commandDefs.ign.command.handleModalSubmit(interaction);
					} else if (interaction.customId.startsWith(SUBMIT_SCORE_ID)) {
						await commandDefs.score.command.handleModalSubmit(interaction);
					}
				} else if (interaction.isButton()) {
					logInteraction('button', interaction.customId);

					if (interaction.customId.startsWith(SUBMIT_SCORE_ID)) {
						await commandDefs.score.command.handleScoreSubmissionButtonClick(interaction);
					}
				} else {
					logInteraction();
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