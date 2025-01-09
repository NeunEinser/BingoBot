import { ActionRowBuilder, AutocompleteInteraction, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ModalBuilder, ModalSubmitInteraction, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Command, SUBMIT_SCORE_ID } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import BotConfig from "../BotConfig";
import { updateOrFetchMessageForSeed } from "../util/weekly_seeds";
import { Seed } from "../repositories/SeedRepository";
import { Player } from "../repositories/PlayerRepository";

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
				.setDescription("The time of the run either 'DNF' or formatted like is shown in Fetchr, partial seconds optional.")
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
			.addStringOption(desc => desc
				.setName("description")
				.setDescription("A description of what happened during the run.")
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
			.addStringOption(desc => desc
				.setName("description")
				.setDescription("A description of what happened during the run.")
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

				await this.handleScoreSubmission(
					interaction,
					seed,
					undefined,
					sub === 'points' ? interaction.options.getInteger('points', true) : undefined,
					interaction.options.getString('time', sub === 'timed'),
					interaction.options.getString('video_url'),
					interaction.options.getString('image_url'),
					interaction.options.getString('description'),
				)

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
							await updateOrFetchMessageForSeed(seed, this.context, this.config);
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

	async handleScoreSubmissionButtonClick(interaction: ButtonInteraction) {
		const week = this.context.db.weeks.getCurrentWeek();
		if (!week) {
			await interaction.reply({ content: 'There is no week currently published.', ephemeral: true });
			return;
		}

		const seed_id = parseInt(interaction.customId.substring(SUBMIT_SCORE_ID.length + 1));
	
		const seed = this.context.db.seeds.getSeed(seed_id)
		if (!seed) {
			await interaction.reply({ content: 'Seed is not part of the current week.', ephemeral: true });
			return;
		}
		let player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
		if (!player) {
			this.context.db.players.createPlayer(interaction.user.id);
			player = this.context.db.players.getPlayer(this.context.db.getLastInsertRowId())!
		}

		const modal = new ModalBuilder()
			.setTitle(`Submit ${seed.game_type === 'points' ? 'points' : 'time'} for seed ${seed.seed}`)
			.setCustomId(`${SUBMIT_SCORE_ID}_${seed.id}`)

		if (!player.in_game_name) {
			const ign_input = new TextInputBuilder()
				.setCustomId('ign')
				.setLabel('What is your in-game name?')
				.setStyle(TextInputStyle.Short)
				.setMinLength(3)
				.setMaxLength(16)
				.setRequired(true);

			const ign_row = new ActionRowBuilder<TextInputBuilder>().addComponents(ign_input);
			modal.addComponents(ign_row);
		}
		if (seed.game_type === 'points') {
			const points_input = new TextInputBuilder()
				.setCustomId('points')
				.setLabel('Points')
				.setStyle(TextInputStyle.Short)
				.setMinLength(1)
				.setMaxLength(2)
				.setRequired(true);
			const points_row = new ActionRowBuilder<TextInputBuilder>().addComponents(points_input);

			modal.addComponents(points_row);
		}
		const time_input = new TextInputBuilder()
			.setCustomId('time')
			.setLabel('Time')
			.setStyle(TextInputStyle.Short)
			.setMinLength(seed.game_type === 'points' ? 0 : 1)
			.setMaxLength(12)
			.setRequired(seed.game_type !== 'points' );
		const time_row = new ActionRowBuilder<TextInputBuilder>().addComponents(time_input);

		const video_url = new TextInputBuilder()
			.setCustomId('video_url')
			.setLabel('Video URL')
			.setStyle(TextInputStyle.Short)
			.setRequired(false);
		const video_row = new ActionRowBuilder<TextInputBuilder>().addComponents(video_url);

		const image_url = new TextInputBuilder()
			.setCustomId('image_url')
			.setLabel('Image URL')
			.setStyle(TextInputStyle.Short)
			.setRequired(false);
		const image_row = new ActionRowBuilder<TextInputBuilder>().addComponents(image_url);

		const description = new TextInputBuilder()
			.setCustomId('description')
			.setLabel('Optional Description of Your Run')
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(false);
		const description_row = new ActionRowBuilder<TextInputBuilder>().addComponents(description);

		modal.addComponents(time_row, video_row, image_row, description_row);
		await interaction.showModal(modal);
	}

	async handleModalSubmit(interaction: ModalSubmitInteraction) {
		const week = this.context.db.weeks.getCurrentWeek();
		if (!week) {
			await interaction.reply({ content: 'There is no week currently published.', ephemeral: true });
			return;
		}

		const seed_id = parseInt(interaction.customId.substring(SUBMIT_SCORE_ID.length + 1));
		const seed = this.context.db.seeds.getSeed(seed_id)
		if (!seed) {
			await interaction.reply({ content: 'Seed is not part of the current week.', ephemeral: true });
			return;
		}

		const player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
		if (!player) {
			await interaction.reply({ content: 'Player was not created correctly, please try again.', ephemeral: true });
			return;
		}

		if (!player.in_game_name) {
			try {
				const ign = interaction.fields.getTextInputValue('ign');
				if (!ign.match(/^[a-zA-Z0-9_]{3,16}$/)) {
					await interaction.reply({ content: 'Invalid in-game name.', ephemeral: true });
					return;
				}
				this.context.db.players.setIgn(interaction.user.id, ign);
				player.in_game_name = ign;
			} catch {
				await interaction.reply({ content: 'Expected in game name.', ephemeral: true });
				return;
			}
		}

		await this.handleScoreSubmission(
			interaction,
			seed,
			player,
			seed.game_type === 'points' ? interaction.fields.getTextInputValue('points') : undefined,
			interaction.fields.getTextInputValue('time'),
			interaction.fields.getTextInputValue('video_url'),
			interaction.fields.getTextInputValue('image_url'),
			interaction.fields.getTextInputValue('description'),
			true,
		)
	}

	private async handleScoreSubmission(
		interaction: ChatInputCommandInteraction,
		seed: Seed,
		player?: undefined,
		points?: number | string | null,
		time?: string | null,
		video_url?: string | null,
		image_url?: string | null,
		description?: string | null,
		ephemeral?: true,
	) : Promise<void>
	private async handleScoreSubmission(
		interaction: ModalSubmitInteraction,
		seed: Seed,
		player: Player,
		points?: number | string,
		time?: string,
		video_url?: string,
		image_url?: string,
		description?: string,
		ephemeral?: true,
	) : Promise<void> 
	private async handleScoreSubmission(
		interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
		seed: Seed,
		player: Player | undefined,
		points?: number | string | null,
		time?: string | null,
		video_url?: string | null,
		image_url?: string | null,
		description?: string | null,
		ephemeral?: true,
	) : Promise<void> {
		const url = video_url?.trim() ? video_url?.trim() : image_url?.trim();

		if (url && (!url.startsWith('https://') || !URL.canParse(url))) {
			await interaction.reply({ content: 'Provided an invalid url.', ephemeral});
			return;
		}

		const url_type = video_url?.trim()
			? 'video' satisfies 'video'
			: url
				? 'image' satisfies 'image'
				: null

		let parsedPoints: null | number;
		if (!points) {
			parsedPoints = null;
		} else if (typeof points === 'number') {
			parsedPoints = points;
		} else if (points.match(/^\d+$/)) {
			parsedPoints = parseInt(points);
		} else {
			interaction.reply({ content: 'Points must be an integer.', ephemeral });
			return;
		}

		if (parsedPoints !== null && (parsedPoints < 0 || parsedPoints > 25)) {
			interaction.reply({ content: 'Points must be between 0 and 25.', ephemeral });
			return;
		}

		let time_in_millis: number | null = null;
		if (time && time.toUpperCase() !== 'DNF') {
			time_in_millis = 0;
			if (!time.match(/^(?:(?:[0-9]{1,2}:)?(?:[0-9]|[0-5][0-9]):)?(?:[0-9]|[0-5][0-9])(?:\.[0-9]{1,3})?$/)) {
				interaction.reply({
					content: 'Invalid time format. Expected format like hh:mm:ss.sss with at least seconds present.\n\n' +
						'Valid examples:\n- 12:45.67\n- 12.345\n- 91:12:45.67\n- 99:59:59.999\n-DNF',
					ephemeral
				});
			}

			const partial_split = time.split('.');
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

		// ts can't wrap its head around the method overload.
		player ??= await this.getOrCreatePlayer(interaction as ChatInputCommandInteraction);
		this.context.db.scores.createOrUpdatePlayerScore(
			seed.id,
			player.id,
			parsedPoints,
			time_in_millis,
			url_type,
			url,
			description
		)

		if (!interaction.replied) {
			await interaction.reply({ content: 'Successfully registered your score.', ephemeral});
		}

		try {
			await updateOrFetchMessageForSeed(seed, this.context, this.config);
		} catch {
			await interaction.followUp('Failed to refresh scoreboard');
		}
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