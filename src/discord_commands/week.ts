import { AutocompleteInteraction, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import SemVer from "../util/SemVer";
import BotConfig from "../BotConfig";
import { constructDiscordMessageAndUpdateIfExists, updateMessageForSeed } from "../util/weekly_seeds";

export default class WeekCommand implements Command {
	constructor(private readonly context: BotContext, private readonly config: BotConfig) {}

	public static readonly data = new SlashCommandBuilder()
		.setName('week')
		.setDescription('Manages weeks for weekly seeds')
		.setDefaultMemberPermissions('0')
		.setContexts(InteractionContextType.Guild)
		.addSubcommand(add => add
			.setName("add")
			.setDescription("Creates a new week")
			.addIntegerOption(week => week
				.setName("week")
				.setDescription("The week number of the seed")
				.setAutocomplete(true)
				.setRequired(true)
			)
			.addStringOption(fetchr_version => fetchr_version
				.setName("fetchr_version")
				.setDescription("The minimum version of Fetchr to be used.")
				.setAutocomplete(true)
				.setRequired(true)
			)
			.addStringOption(minecraft_version => minecraft_version
				.setName("minecraft_version")
				.setDescription("The minimum version of Minecraft to be used.")
				.setAutocomplete(true)
				.setRequired(true)
			)
			.addStringOption(fetchr_version => fetchr_version
				.setName("max_fetchr_version")
				.setDescription("The maximum version of Fetchr to be used. If not set, maximum equals minimum")
				.setAutocomplete(true)
			)
			.addStringOption(minecraft_version => minecraft_version
				.setName("max_minecraft_version")
				.setDescription("The maximum version of Minecraft to be used. If not set, maximum equals minimum")
				.setAutocomplete(true)
			)
			.addStringOption(desc => desc
				.setName("description")
				.setDescription("Additional text for the weeek, e.g. for additional info.")
				.setRequired(false)
			)
		)
		.addSubcommand(preview => preview
			.setName("preview")
			.setDescription("Sends a preview that looks like it will be published when using publish")
			.addIntegerOption(week => week
				.setName("week")
				.setDescription("The week number of the seed")
				.setAutocomplete(true)
				.setRequired(true)
			)
		)
		.addSubcommand(publish => publish
			.setName("publish")
			.setDescription("Publishes all seeds from a week")
			.addIntegerOption(week => week
				.setName("week")
				.setDescription("The week number of the seed")
				.setAutocomplete(true)
				.setRequired(true)
			)
		)
		.addSubcommand(refresh => refresh
			.setName("refresh")
			.setDescription("Forcefully updates the message with the current weekly seeds")
		)

	async execute(interaction: ChatInputCommandInteraction) {
		switch (interaction.options.getSubcommand()) {
			case 'add': {
				await this.add(interaction);
				break;
			}
			case 'preview': {
				const week = this.context.db.weeks.getWeekByWeekNumber(interaction.options.getInteger('week', true));
				if (!week) {
					await interaction.reply('Could not find week.');
					return;
				}
				const msg = await constructDiscordMessageAndUpdateIfExists(week, this.context, this.config);
				await interaction.reply(msg);
				break;
			}
			case 'publish': {
				await interaction.deferReply();
				const weekNumber = interaction.options.getInteger('week', true);
				const week = this.context.db.weeks.getWeekByWeekNumber(weekNumber);
				if (!week) {
					await interaction.editReply('Could not find week.');
					return;
				}
				if (week.published_on || week.discord_message_id) {
					await interaction.editReply('Week is already published.');
					return;
				}
				week.published_on = new Date();
				const payload = await constructDiscordMessageAndUpdateIfExists(week, this.context, this.config);

				const channel = await interaction.guild?.channels.fetch(this.config.weeklySeedsChannel);
				if (!channel?.isTextBased()) {
					await interaction.editReply('Could not get configured weekly seeds channel as text channel.');
					return;
				}
				const message = await channel.send(payload);
				this.context.db.weeks.publishWeek(week.id, message.id);
				if (message.crosspostable) {
					await message.crosspost();
				}
				const seeds = this.context.db.seeds.getSeedsByWeekId(week.id);

				for (let seed of seeds) {
					const seedPayload = await updateMessageForSeed(seed, this.context, this.config);
					const seedMessage = await channel.send(seedPayload);
					this.context.db.seeds.publishSeed(seed.id, seedMessage.id);
					// if (seedMessage.crosspostable) {
					// 	await seedMessage.crosspost();
					// }
				}
				await interaction.editReply("Successfully published week.");
				break;
			}
			case 'refresh': {
				await interaction.deferReply();
				const week = this.context.db.weeks.getCurrentWeek();
				if (!week) {
					await interaction.editReply("No week has been published yet.")
					return;
				}

				await constructDiscordMessageAndUpdateIfExists(week, this.context, this.config);
				const seeds = this.context.db.seeds.getSeedsByWeekId(week.id);

				const channel = await interaction.guild?.channels.fetch(this.config.weeklySeedsChannel);
				if (!channel?.isTextBased()) {
					await interaction.editReply('Could not get configured weekly seeds channel as text channel.');
					return;
				}
				for (let seed of seeds) {
					const seedPayload = await updateMessageForSeed(seed, this.context, this.config);
					if (!seed.discord_message_id) {
						const seedMessage = await channel.send(seedPayload);
						this.context.db.seeds.publishSeed(seed.id, seedMessage.id);
						// if (seedMessage.crosspostable) {
						// 	await seedMessage.crosspost();
						// }
					}
				}

				await interaction.editReply("Successfully refreshed current week.");
				break;
			}
		}
	}

	async autocomplete(interaction: AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		switch (focused.name) {
			case 'week': {
				if (interaction.options.getSubcommand() == "add") {
					const nextNumber = this.context.db.weeks.getNextWeekNumber();

					if (nextNumber.toString().startsWith(focused.value)) {
						return [{ name: nextNumber.toString(), value: nextNumber }]
					} else {
						return [];
					}
				}
				const weeks = this.context.db.weeks.getUnpublishedFilteredWeeks(focused.value, 25);
				return weeks.map(w => ({ name: w.week.toString(), value: w.week }));
			}
			case 'fetchr_version':
			case 'max_fetchr_version':
			case 'minecraft_version':
			case 'max_minecraft_version': {
				const version = focused.value.split('.');
				if (version.length > 3) {
					return [];
				}
				while (version.length < 3) {
					version.push('');
				}

				let versions = focused.name.includes("fetchr")
					? this.context.db.versions.getFilteredVersions(version[0], version[1], version[2], 25)
					: this.context.db.versions.getFilteredMinecraftVersions(version[0], version[1], version[2], 25)

				if (focused.name.startsWith('max_')) {
					const min_version_str = interaction.options.getString(focused.name.substring(4));
					if (min_version_str) {
						try {
							const min_version = SemVer.fromString(min_version_str);
							versions = versions.filter(v => v.major > min_version.major && v.minor > min_version.minor && v.patch > min_version.patch);
						} catch {}
					}
				}

				return versions.map(v => ({ name: v.toString(), value: v.toString() }))
			}
		}
		return undefined;
	}

	private async add(interaction: ChatInputCommandInteraction) {
		const week = interaction.options.getInteger("week", true);
		const version_str = interaction.options.getString("fetchr_version", true);
		const mc_version_str = interaction.options.getString("minecraft_version", true);
		const max_version_str = interaction.options.getString("max_fetchr_version");
		const max_mc_version_str = interaction.options.getString("max_minecraft_version");
		const desc = interaction.options.getString("description");
	
		let version: SemVer | undefined = undefined;
		let mc_version: SemVer | undefined = undefined;
		let max_version: SemVer | undefined = undefined;
		let max_mc_version: SemVer | undefined = undefined;
	
		const existing = this.context.db.weeks.getWeekByWeekNumber(week);
		if (existing && (!existing.published_on || !existing.discord_message_id)) {
			await interaction.reply('Unpublished week with same week number already exists. '
				+ 'Only one week with a specific number can exist while unpublished to avoid ambuigity in other commands.');
			return;
		}

		try {
			version = SemVer.fromString(version_str)
		} catch (err) {
			await interaction.reply(`Invalid version string ${version_str}: ${(err as Error)?.message}`);
			return;
		}
		
		try {
			mc_version = SemVer.fromString(mc_version_str)
		} catch (err) {
			await interaction.reply(`Invalid version string ${mc_version_str}: ${(err as Error)?.message}`);
			return;
		}
	
		if (max_version_str) {
			try {
				max_version = SemVer.fromString(max_version_str)
			} catch (err) {
				await interaction.reply(`Invalid version string ${max_version_str}: ${(err as Error)?.message}`);
				return;
			}
		}
	
		if (max_mc_version_str) {
			try {
				max_mc_version = SemVer.fromString(max_mc_version_str)
			} catch (err) {
				await interaction.reply(`Invalid version string ${max_mc_version_str}: ${(err as Error)?.message}`);
				return;
			}
		}
	
		this.context.db.weeks.createWeek(week, version, mc_version, max_version, max_mc_version, desc);
		await interaction.reply("Successfully created week.");
	}
}

