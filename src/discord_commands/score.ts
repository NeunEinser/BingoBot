import { ActionRowBuilder, AutocompleteInteraction, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ComponentType, LabelBuilder, ModalBuilder, ModalSubmitInteraction, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Command, SUBMIT_SCORE_ID } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import BotConfig from "../BotConfig";
import { millisToTimeStamp, constructAndUpdateSeedMessage } from "../util/weekly_seeds";
import { Seed } from "../repositories/SeedRepository";
import { Player } from "../repositories/PlayerRepository";
import { getLogger } from "log4js";

interface ModalOptions {
	include_ign?: boolean,
	ign?: string | null,
	points?: number | string | null,
	time?: string | null,
	video_url?: string | null,
	image_url?: string | null,
	description?: string | null,
}

export default class ScoreCommand implements Command {
	private readonly logger = getLogger('interaction');
	private readonly failedModals: Map<number, Map<number, { timeout: NodeJS.Timeout, options: ModalOptions}>> = new Map();

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
				const seed_id = interaction.options.getInteger('seed_id', true);
				const seed = this.context.db.seeds.getSeed(seed_id)
				if (!seed) {
					await interaction.reply(`Could not find seed with id ${seed_id}.`);
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
					const user_reply = await response.awaitMessageComponent<ComponentType.Button>({
						filter: i => i.user.id === interaction.user.id,
						time: 60_000
					});

					await user_reply.update({ components: [] });
					if (user_reply.customId !== 'delete') {
						await user_reply.followUp('Deletion has been cancelled by user');
						return;
					} else {
						this.context.db.scores.deleteScore(player.id, seed.id);
						await user_reply.followUp('Deleted submission successfully.');

						try {
							await constructAndUpdateSeedMessage(seed, this.context, this.config);
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
		const seed_id = parseInt(interaction.customId.substring(SUBMIT_SCORE_ID.length + 1));
		const player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
		const score = player ? this.context.db.scores.getPlayerScore(player.id, seed_id) : null;
	
		const seed = score?.seed ?? this.context.db.seeds.getSeed(seed_id);
		if (!seed) {
			await interaction.reply({ content: `Could not find seed with id ${seed_id}.`, ephemeral: true });
			return;
		}

		await this.openModal(
			interaction,
			seed,
			(this.failedModals.get(seed.id)?.get(player?.id ?? -1))?.options ?? {
				include_ign: !player?.in_game_name,
				points: score?.points,
				time: score && (seed.game_type !== 'points' || score.time_in_millis) ? millisToTimeStamp(score.time_in_millis, true, true) : null,
				image_url: score?.url_type === 'image' ? score.url : null,
				video_url: score?.url_type === 'video' ? score.url : null,
				description: score?.description,
			}
		)
	}

	private async openModal(
		interaction: ButtonInteraction,
		seed: Seed,
		options?: ModalOptions,
	) {
		const modal = new ModalBuilder()
			.setTitle(`Submit ${seed.game_type === 'points' ? 'points' : 'time'} for seed ${seed.seed}`)
			.setCustomId(`${SUBMIT_SCORE_ID}_${seed.id}`)

		let ign_input = undefined;
		if (options?.include_ign) {
			ign_input = new TextInputBuilder()
				.setCustomId('ign')
				.setLabel('What is your in-game name?')
				.setStyle(TextInputStyle.Short)
				.setMinLength(3)
				.setMaxLength(16)
				.setRequired(true);

			const ign_row = new ActionRowBuilder<TextInputBuilder>().addComponents(ign_input);
			modal.addComponents(ign_row);
		}
		let points_input = undefined;
		if (seed.game_type === 'points') {
			points_input = new TextInputBuilder()
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
		if (options) {
			if (options.points !== undefined && options.points !== null) {
				points_input?.setValue(options.points.toString());
			}
			if (options.ign) {
				ign_input?.setValue(options.ign);
			}
			if (options.time) {
				time_input.setValue(options.time);
			}
			if (options.video_url) {
				video_url.setValue(options.video_url);
			}
			if (options.image_url) {
				image_url.setValue(options.image_url);
			}
			if (options.description) {
				description.setValue(options.description);
			}
		}

		modal.addComponents(time_row, video_row, image_row, description_row);
		await interaction.showModal(modal);
	} 

	async handleModalSubmit(interaction: ModalSubmitInteraction) {
		const seed_id = parseInt(interaction.customId.substring(SUBMIT_SCORE_ID.length + 1));

		const getInGameName = (): { is_error: true, error_message: string, ign?: undefined } | { is_error: false, error_message?: undefined, ign: string } => {
			try {
				const ign = interaction.fields.getTextInputValue('ign');
				if (!ign.match(/^[a-zA-Z0-9_]{3,16}$/)) {
					return { is_error: true, error_message: 'Invalid in-game name.' };
				}
				return { is_error: false, ign };
			} catch {
				this.logger.error('Modal submit did not contain an in-game name even though it should have.');
				return { is_error: true, error_message: 'Expected in-game name in submission.' };
			}
		}

		const seed = this.context.db.seeds.getSeed(seed_id);
		if (!seed) {
			await interaction.reply({ content: `Could not find seed with id ${seed_id}.`, ephemeral: true });
			return;
		}

		let player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
		if (!player) {
			const { ign } = getInGameName();
			this.context.db.players.createPlayer(interaction.user.id, ign ?? null);
			player = this.context.db.players.getPlayer(this.context.db.getLastInsertRowId())!
		}

		const points = seed.game_type === 'points' ? interaction.fields.getTextInputValue('points') : undefined;
		const time = interaction.fields.getTextInputValue('time');
		const video_url = interaction.fields.getTextInputValue('video_url');
		const image_url = interaction.fields.getTextInputValue('image_url');
		const description = interaction.fields.getTextInputValue('description');

		const postError = async (msg?: string) => {
			let forSeed = this.failedModals.get(seed.id);
			if (!forSeed) {
				forSeed = new Map();
				this.failedModals.set(seed.id, forSeed);
			}

			const old = forSeed.get(player.id);
			if (old) {
				clearTimeout(old.timeout);
			}

			const timeout = setTimeout(() => {
				const failedForSeed = this.failedModals.get(seed_id);
				if (failedForSeed)
					failedForSeed.delete(player.id);
				if (failedForSeed?.size === 0)
					this.failedModals.delete(seed_id);
			}, 300_000);

			forSeed.set(player.id, {
				timeout,
				options: {
					include_ign: !player.in_game_name,
					ign: player.in_game_name,
					points,
					time,
					image_url,
					video_url,
					description,
				}
			});

			this.logger.info(`Replying to ${interaction.user.displayName}: \n"${msg ?? 'Failed to submit score'}"`);
			await interaction.reply({
				content: msg ?? 'Failed to submit score',
				ephemeral: true,
			});
		}

		try {
			if (!player.in_game_name) {
				const ign_result = getInGameName()
				if (ign_result.is_error) {
					await postError(ign_result.error_message);
				} else {
					this.context.db.players.setIgn(interaction.user.id, ign_result.ign);
					player.in_game_name = ign_result.ign;
				}
			}

			const response = await this.handleScoreSubmission(
				interaction,
				seed,
				player,
				points,
				time,
				video_url,
				image_url,
				description,
				true,
			)

			if (response.is_error) {
				await postError(response.message);
				return;
			}

			const failedForSeed = this.failedModals.get(seed_id);
			if (failedForSeed) {
				const playerFail = failedForSeed.get(player.id);
				if (playerFail) {
					clearTimeout(playerFail.timeout);
					failedForSeed.delete(player.id);
				}

				if (failedForSeed.size === 0) {
					this.failedModals.delete(seed_id);
				}
			}
		} catch (e) {
			await postError();
			throw e;
		}
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
	) : Promise<{ message?: string; is_error: boolean }>
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
	) : Promise<{ message?: string; is_error: boolean }> 
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
	) : Promise<{ message?: string; is_error: boolean }> {
		const week = this.context.db.weeks.getCurrentWeek();
		if (week?.id !== seed.week.id) {
			return { message: 'Seed is not part of the current week.', is_error: true };
		}

		const url = video_url?.trim() ? video_url?.trim() : image_url?.trim();

		if (url && (!url.startsWith('https://') || !URL.canParse(url))) {
			return { message: 'Invalid url.', is_error: true };
		}

		const url_type = video_url?.trim()
			? 'video' satisfies 'video'
			: url
				? 'image' satisfies 'image'
				: null

		let parsedPoints: null | number;
		if (points === null || points === undefined || points === '') {
			parsedPoints = null;
		} else if (typeof points === 'number') {
			parsedPoints = points;
		} else if (points.match(/^\d+$/)) {
			parsedPoints = parseInt(points);
		} else {
			return { message: 'Points must be an integer.', is_error: true };
		}

		if (parsedPoints !== null && (parsedPoints < 0 || parsedPoints > 25)) {
			return { message: 'Points must be between 0 and 25.', is_error: true };
		}

		let time_in_millis: number | null = null;
		if (time && time.toUpperCase() !== 'DNF') {
			time_in_millis = 0;
			if (!time.match(/^(?:(?:[0-9]{1,2}:)?(?:[0-9]|[0-5][0-9]):)?(?:[0-9]|[0-5][0-9])(?:\.[0-9]{1,3})?$/)) {
				return {
					message: 'Invalid time format. Expected format like hh:mm:ss.sss with at least seconds present.\n\n' +
						'Valid examples:\n- 12:45.67\n- 12.345\n- 91:12:45.67\n- 99:59:59.999\n- DNF',
					is_error: true,
				};
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
				switch (partial_split[1].length) {
					case 1:
						partial *= 100;
						break;
					case 2:
						partial *= 10;
						break;
				}
			}
			time_in_millis += partial;
		}

		// It's always ChatInputCommandInteraction here, ts can't wrap its head around the method
		// overload.
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
			this.logger.info(`Registered new score for ${interaction.user.displayName}.`);
			await interaction.reply({ content: 'Successfully registered your score.', ephemeral});
		}

		if (player.in_game_name) {
			try {
				await constructAndUpdateSeedMessage(seed, this.context, this.config);
			} catch (err) {
				this.logger.error(`Failed to refresh scoreboard for ${interaction.user.displayName}:\n${err}`);
				await interaction.followUp({ content: 'Failed to refresh scoreboard.', ephemeral});
			}
		}
		return { is_error: false };
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