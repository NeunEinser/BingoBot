import { ActionRowBuilder, AutocompleteInteraction, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";

const SEED_TYPES = [
	'bingo',
	'blackout',
	'20_no_bingo',
	'double_bingo',
	'triple_bingo',
	'quadruple_bingo',
	'points_in_25_minutes',
	'practiced_bingo_or_blackout'
];

export default class SeedCommand implements Command {
	constructor(private readonly context: BotContext) {}

	public static readonly data = new SlashCommandBuilder()
		.setName('seed')
		.setDescription('Manages weekly seeds')
		.setDefaultMemberPermissions('0')
		.setContexts(InteractionContextType.Guild)
		.addSubcommand(add => add
			.setName("add")
			.setDescription("Adds a new seed for the weeklies")
			.addIntegerOption(week => week
				.setName("week")
				.setDescription("The week number of the seed")
				.setAutocomplete(true)
				.setRequired(true)
			)
			.addIntegerOption(seed => seed
				.setName("seed")
				.setDescription("The numeric Fetchr seed")
				.setRequired(true)
				.setMinValue(-(2**31))
				.setMaxValue(2**31-1)
			)
			.addStringOption(type => type
				.setName("type")
				.setDescription("The type of seed")
				.addChoices(
					SEED_TYPES.map(t => ({
						name: t.split('_').map(s => s[0].toUpperCase() + s.substring(1)).join(' '),
						value: t
					}))
				)
				.setRequired(true)
			)
			.addStringOption(desc => desc
				.setName("description")
				.setDescription("Additional text for the seed, e.g. Practice Seed Credits")
				.setRequired(false)
			)
		)
		.addSubcommand(rm => rm
			.setName("remove")
			.setDescription("Remove a seed. This will permanentley delete any submitted scores, too!")
			.addIntegerOption(seed => seed
				.setName("seed_id")
				.setDescription("The numeric Fetchr seed")
				.setAutocomplete(true)
				.setRequired(true)
			)
		)

	async execute(interaction: ChatInputCommandInteraction) {
		switch (interaction.options.getSubcommand()) {
			case 'add': {
				const week = this.context.db.weeks.getWeekByWeekNumber(interaction.options.getInteger("week", true));
				if (!week) {
					await interaction.reply("Could not find week!")
					return;
				}

				const seed = interaction.options.getInteger("seed", true);
				const type = interaction.options.getString("type", true);
				if (type !== 'practiced_bingo_or_blackout') {
					if (!seed.toString().startsWith(week.week.toString())) {
						await interaction.reply(`**Warning:** Expected seed to start with week number ${week.week}.`);
					} else if (seed.toString().length !== week.week.toString().length + 3) {
						await interaction.reply(`**Warning:** Expected seed to have exactly three digits after the week number, but found ${seed.toString().length - week.week.toString().length}.`);
					}
				}
				this.context.db.seeds.createSeed(
					week.id,
					seed,
					SEED_TYPES.indexOf(type),
					type == 'points_in_25_minutes' ? 25 : type === 'practiced_bingo_or_blackout' ? '[0, 1]' : null,
					interaction.options.getString("description"),
				)

				if (!interaction.replied) {
					await interaction.reply('Created seed successfully.');
				} else {
					await interaction.followUp('Created seed successfully.');
				}
				break;
			}

			case 'remove': {
				const seed = this.context.db.seeds.getSeed(interaction.options.getInteger('seed_id', true));

				if (!seed) {
					await interaction.reply('Could not find seed.')
					return;
				}

				if (seed.week.published_on) {
					const deleteBtn = new ButtonBuilder()
						.setCustomId('delete')
						.setLabel('Delete')
						.setStyle(ButtonStyle.Danger);

					const cancelBtn = new ButtonBuilder()
					.setCustomId('cancel')
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary)

					const btnRow = new ActionRowBuilder<ButtonBuilder>()
						.setComponents(cancelBtn, deleteBtn);

					const response = await interaction.reply({
						content: `This seed has already been published on ${
								seed.week.published_on.toLocaleDateString('en-us', { month: 'long', day: 'numeric', year: 'numeric', weekday: 'long'})
							}. Are you sure you want to delete this seed?
							
							**This will also permanently delete all submitted scores!**`,
						components: [btnRow]
					});

					try {
						const user_reply = await response.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 60_000 });

						await user_reply.update({ components: [] });
						if (user_reply.customId !== 'delete') {
							await user_reply.followUp('Deletion has been cancelled by user');
							return;
						} else {
							this.context.db.seeds.deleteSeed(seed.id);
							await user_reply.followUp('Deleted seed and submitted scores successfully.');
						}
					} catch {
						await interaction.editReply({content: 'Confirmation not recieved within a minute, cancelling', components: [] });
						return;
					}
				} else {
					this.context.db.seeds.deleteSeed(seed.id);
					await interaction.reply('Deleted unpublished seed successfully.');
				}

				break;
			}
		}
	}

	async autocomplete(interaction: AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		switch (focused.name) {
			case 'week': {
				return this.context.db.weeks.getFilteredWeeks(focused.value, 25)
					.map(w => ({ name: w.week.toString(), value: w.week }));
			}
			case 'seed_id': {
				return this.context.db.seeds.getFilteredSeeds(focused.value, 25)
					.map(s => ({
						name: `${s.seed} (id: ${s.id}) (${s.week.published_on
							? 'published on: ' + s.week.published_on.toISOString().split('T')[0]
							: 'not published'
						})`,
						value: s.id
					}));
			}
		}
		return [];
	}
}