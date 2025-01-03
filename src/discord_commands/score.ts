import { ActionRowBuilder, AutocompleteInteraction, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, InteractionContextType, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import BotConfig from "../BotConfig";
import { updateMessageForSeed } from "../util/weekly_seeds";

export default class ScoreCommand implements Command {
	constructor(private readonly context: BotContext, private readonly config: BotConfig) {}

	public static readonly data =	new SlashCommandBuilder()
		.setName("score")
		.setDescription("Submit a score for the weekly seeds.")
		.addSubcommand(timed => timed
			.setName("timed")
			.setDescription("Submit a score for a timed weekly seed.")
			.addIntegerOption(seed => seed
				.setName("seed_id")
				.setDescription("The internal id of the seed. Use autocomplete.")
				.setAutocomplete(true)
				.setRequired(true)
			)
			.addStringOption(time => time
				.setName("time")
				.setDescription("The time of the run formatted like is shown in Fetchr, partial seconds optional.")
				.setRequired(true)
			)
			.addStringOption(video_url => video_url
				.setName("video_url")
				.setDescription("Link to a video proving your time.")
			)
			.addStringOption(image_url => image_url
				.setName("image_url")
				.setDescription("Link to a screenshot after run completion.")
			)
		)
		.addSubcommand(points => points
			.setName("points")
			.setDescription("Submit a score for a points weekly seed.")
			.addIntegerOption(seed => seed
				.setName("seed_id")
				.setDescription("The internal id of the seed. Use autocomplete.")
				.setAutocomplete(true)
				.setRequired(true)
			)
			.addIntegerOption(points => points
				.setName("points")
				.setDescription("The number of obtained points.")
				.setMinValue(0)
				.setMaxValue(25)
				.setRequired(true)
			)
			.addStringOption(time => time
				.setName("time")
				.setDescription("The time when you obtained the last item as a tie breaker, especially if you got all 25 items.")
			)
			.addStringOption(video_url => video_url
				.setName("video_url")
				.setDescription("Link to a video proving your score.")
			)
			.addStringOption(image_url => image_url
				.setName("image_url")
				.setDescription("Link to a screenshot after run completion.")
			)
		)
		.addSubcommand(remove => remove
			.setName("remove")
			.setDescription("Remove your score for a seed.")
			.addIntegerOption(seed => seed
				.setName("seed_id")
				.setDescription("The internal id of the seed. Use autocomplete.")
				.setAutocomplete(true)
				.setRequired(true)
			)
		)

	async execute(interaction: ChatInputCommandInteraction) {
		const sub = interaction.options.getSubcommand();
		switch (sub) {
			case 'points':
			case 'timed': {
				const week = this.context.db.weeks.getCurrentWeek();
				if (!week) {
					await interaction.reply('There is no week currently published.');
					return;
				}

				const seed = this.context.db.seeds.getSeed(interaction.options.getInteger('seed_id', true))
				if (!seed) {
					await interaction.reply('Seed is not part of the current week.');
					return;
				}
				switch (sub) {
					case "points": 
						if (seed.game_type !== 'points') {
							await interaction.reply('Seed is not a points seed. Use `/seed timed` instead.');
							return;
						}
						break;
					case "timed": 
						if (seed.game_type === 'points') {
							await interaction.reply('Seed is a points seed. Use `/seed points` instead.');
							return;
						}
						break;
				}

				const video_url = interaction.options.getString('video_url');
				const image_url = interaction.options.getString('image_url');
				const url = video_url ?? image_url;

				if (url && (!url.startsWith('https://') || !URL.canParse(url))) {
					await interaction.reply('Provided an invalid url.');
					return;
				}

				const url_type = video_url != null
					? 'video' satisfies 'video'
					: image_url != null
						? 'image' satisfies 'image'
						: null

				const time_str = interaction.options.getString('time', sub === 'timed');
				let time_in_millis: number | null = null;
				if (time_str) {
					time_in_millis = 0;
					if (!time_str.match(/^(?:(?:[0-9]{1,2}:)?(?:[0-9]|[0-5][0-9]):)?(?:[0-9]|[0-5][0-9])(?:\.[0-9]{1,3})?$/)) {
						interaction.reply('Invalid time format. Expected format like hh:mm:ss.sss with at least seconds present.\n\n' +
							'Valid examples:\n- 12:45.67\n- 12.345\n- 91:12:45.67\n- 99:59:59.999'
						);
					}

					const partial_split = time_str.split('.');
					const whole_components = partial_split[0].split(':');
					for (let component of whole_components) {
						time_in_millis *= 60;
						time_in_millis += parseInt(component);
					}
					time_in_millis *= 1000;
					let partial = partial_split.length === 2 ? parseInt(partial_split[1]) : 0;
					if (partial !== 0) {
						if (partial < 10) {
							partial *= 10
						}
						if (partial < 100) {
							partial *= 10
						}
					}
					time_in_millis += partial;
				}

				const player = await this.getOrCreatePlayer(interaction);
				this.context.db.scores.createOrUpdatePlayerScore(
					seed.id,
					player.id,
					sub === 'points' ? interaction.options.getInteger('points', true) : null,
					time_in_millis,
					url_type,
					url
				)

				if (!interaction.replied) {
					await interaction.reply('Successfully registered your score.');
				}

				try {
					await updateMessageForSeed(seed, this.context, this.config);
				} catch {
					await interaction.followUp('Failed to refresh scoreboard');
				}
				break;
			}
			case 'remove': {
				const week = this.context.db.weeks.getCurrentWeek();
				if (!week) {
					await interaction.reply('There is no week currently published.');
					return;
				}

				const seed = this.context.db.seeds.getSeed(interaction.options.getInteger('seed_id', true))
				if (!seed) {
					await interaction.reply('Seed is not part of the current week and cannot be removed anymore.');
					return;
				}
				const player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
				if (!player) {
					await interaction.reply('You do not have a score submitted for this seed.');
					return;
				}

				const score = this.context.db.scores.getPlayerScore(player.id, seed.id);
				if (!score) {
					await interaction.reply('You do not have a score submitted for this seed.');
					return;
				}

				const deleteBtn = new ButtonBuilder()
					.setCustomId('delete')
					.setLabel('Delete')
					.setStyle(ButtonStyle.Danger);

				const cancelBtn = new ButtonBuilder()
					.setCustomId('cancel')
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary);

				const btnRow = new ActionRowBuilder<ButtonBuilder>()
					.setComponents(cancelBtn, deleteBtn);

				const response = await interaction.reply({
					content: `Are you sure you want to delete your submission for seed ${seed.seed} and rank ${score.rank ?? 'none'}?`,
					components: [btnRow]
				});

				try {
					const user_reply = await response.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 60_000 });

					await user_reply.update({ components: [] });
					if (user_reply.customId !== 'delete') {
						await user_reply.followUp('Deletion has been cancelled by user');
						return;
					} else {
						this.context.db.scores.deleteScore(player.id, seed.id);
						await user_reply.followUp('Deleted submission successfully.');

						try {
							await updateMessageForSeed(seed, this.context, this.config);
						} catch {
							await interaction.followUp('Failed to refresh scoreboard');
						}
					}
				} catch {
					await interaction.editReply({components: [] });
					await interaction.followUp('Confirmation not recieved within a minute, cancelling');
					return;
				}
			}
		}
	}

	async autocomplete(interaction: AutocompleteInteraction) {
		const week = this.context.db.weeks.getCurrentWeek();
		if (!week) {
			return [];
		}
		const filter = interaction.options.getFocused();
		let seeds = this.context.db.seeds.getFilteredSeedsByWeek(filter, week.id, 25);

		switch (interaction.options.getSubcommand()) {
			case 'remove':
				const player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
				if (!player) {
					return [];
				}
				const scores = this.context.db.scores.getPlayerScoresByPlayerAndWeek(player.id, week.id, 1000);

				seeds = seeds.filter(s => scores.some(sc => sc.seed.seed === s.seed));
				break;
			case 'points':
				seeds = seeds.filter(s => s.game_type === 'points');
				break;
			case 'timed':
				seeds = seeds.filter(s => s.game_type !== 'points');
				break;
		}

		return seeds.map(s => ({ name: s.seed.toString() + (s.practiced ? ` (${s.game_type.replace('_', '-')})` : ''), value: s.id }));
	}

	private async getOrCreatePlayer(interaction: ChatInputCommandInteraction) {
		let player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
		if (!player?.in_game_name) {
			if (!player) {
				this.context.db.players.createPlayer(interaction.user.id);
				player = this.context.db.players.getPlayer(this.context.db.getLastInsertRowId())!
			}

			const ign_input = new TextInputBuilder()
				.setCustomId('ign')
				.setLabel('What is your in-game name?')
				.setStyle(TextInputStyle.Short)
				.setMinLength(3)
				.setMaxLength(16)
				.setRequired(true);
			const ign_row = new ActionRowBuilder<TextInputBuilder>().addComponents(ign_input);

			const modal = new ModalBuilder()
				.setTitle("Set in-game name")
				.setCustomId("ign")
				.setComponents(ign_row);

			await interaction.showModal(modal);
			await interaction.followUp('Score has been registered but will only show after supplying an in-game name');
		}
		return player;
	}
}