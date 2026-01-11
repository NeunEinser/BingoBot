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
import { getLogger } from 'log4js';
import RecapCommand from './discord_commands/recap';
import RecapDmCommand from './discord_commands/recap-dm';

export interface Command {
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>,
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<ApplicationCommandOptionChoiceData[] | undefined>,
}

export const SUBMIT_SCORE_ID = 'submit_seed_score'

export default class CommandRegistry {
	private readonly logger = getLogger('interaction');
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
			recap: { data: RecapCommand.data, command: new RecapCommand(this.context, this.config) },
			recap_dm: { data: RecapDmCommand.data, command: new RecapDmCommand(this.context, this.config) },
		}

		const commandLookup: Record<string, { data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder, command: Command}>
			= commandDefs;

		await commandApi.set(Object.values(commandDefs).map(d => d.data.toJSON()));

		this.context.discordClient.on(Events.InteractionCreate, async interaction => {
			const logInteraction = (type?: string, name?: string) => {
				this.logger.info(`Received ${type ?? 'unknown'} interaction${name ? ' for ' + name : ''} by ${interaction.user.displayName}\n${JSON.stringify(
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
						this.logger.error(`Could not find matching command definition for ${interaction.commandName}`);
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
						this.logger.warn(`Command ${interaction.commandName} does not have an autocomplete script defined.`);
					}
				} else if (interaction.isChatInputCommand()) {
					logInteraction('command', interaction.commandName);
					const command = commandLookup[interaction.commandName.replace("-", "_")]?.command;
					if (!command) {
						this.logger.error(`Could not find matching command definition for ${interaction.commandName}`);
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
					this.logger.error(err);
					const reply = async (message: string) => {
						if(interaction.isCommand()) {
							if (interaction.replied || interaction.deferred) {
								await interaction.followUp(message);
							} else {
								await interaction.reply(message);
							}
						}
					}

					if(interaction.isCommand()) {
						await reply("Command execution failed");
					} else if (interaction.isButton()) {
						await reply("Failed to process button click");
					} else if (interaction.isModalSubmit()) {
						await reply("Failed to submit modal");
					} else if (interaction.isAutocomplete()) {
						await interaction.respond([]);
					}
				} catch (_) {}
			}
		});
	}
}