import { AutocompleteInteraction, BaseMessageOptionsWithPoll, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import SemVer from "../util/SemVer";
import BotConfig from "../BotConfig";

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
				const msg = this.constructDiscordMessage(interaction.options.getInteger('week', true));
				if (msg === null) {
					await interaction.reply('Could not find week.');
					return
				}

				await interaction.reply(msg);
				break;
			}
			case 'publish': {
				const weekNumber = interaction.options.getInteger('week', true);
				const week = this.context.db.weeks.getWeekByWeekNumber(weekNumber);
				if (!week) {
					await interaction.reply('Could not find week.');
					return;
				}
				if (week.published_on || week.discord_message_id) {
					await interaction.reply('Week is already published.');
					return;
				}
				const payload = this.constructDiscordMessage(weekNumber);
				if (!payload) {
					await interaction.reply('Could not create message payload.');
					return;
				}

				const channel = await interaction.guild?.channels.fetch(this.config.weeklySeedsChannel);
				if (!channel?.isTextBased()) {
					await interaction.reply('Could not get configured weekly seeds channel as text channel.');
					return;
				}
				const message = await channel.send(payload);
				this.context.db.weeks.publishWeek(weekNumber, message.id);
				if (message.crosspostable) {
					await message.crosspost();
				}
				break;
			}
		}
	}

	async autocomplete(interaction: AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		switch (focused.name) {
			case 'week': {
				if (interaction.options.getSubcommand() == "add") {
					const currentWeek = this.context.db.weeks.getCurrentWeek();
					const nextNumber = (currentWeek?.week ?? 0) + 1;

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
	
		const existing = this.context.db.weeks.getUnpublishedFilteredWeeks(week.toString(), 100);
		if (existing.some(w => w.week === week)) {
			await interaction.reply('Unpublished week with same week number already exists.'
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
	}

	private constructDiscordMessage(weekNumber: number): BaseMessageOptionsWithPoll | null {
		const week = this.context.db.weeks.getWeekByWeekNumber(weekNumber);
		if (!week) {
			return null;
		}

		const fetchrVersionStr = week.version.toString() + (week.max_version ? '-' + week.max_version.toString() : '');
		const mcVersionStr = week.mc_version.toString() + (week.max_mc_version ? '-' + week.max_mc_version.toString() : '');
		const seeds = this.context.db.seeds.getSeedsByWeekId(week.id);
		const publishedOn = week.published_on ?? new Date();
		const toFri = (publishedOn.getDay() + 2) % 7;
		const date = new Date(publishedOn);
		date.setDate(date.getDate() - toFri);

		let message = '';
		if (week.description) {
			message += week.description + '\n\n';
		}
		message += `Fetchr ${fetchrVersionStr} (MC ${mcVersionStr}) seeds for ${date.toLocaleDateString('en-us', { month: 'long', day: 'numeric', year: 'numeric' })}:\n\n`;
		
		for (let seed of seeds) {
			message += 'weekly '
			switch (seed.game_type) {
				case 0: message += 'blind bingo'; break;
				case 1: message += 'blind blackout'; break;
				case 2: message += 'blind 20-no-bingo'; break;
				case 3: message += 'blind double-bingo'; break;
				case 4: message += 'blind triple-bingo'; break;
				case 5: message += 'blind quadruple-bingo'; break;
				case 6: message += `blind points-in-${seed.game_type_specific}-mins`; break;
				case 7: message += 'practiced'; break;
			}

			message += ` seed: ${seed.seed}`
			if (seed.description) {
				message += ` (${seed.description})`;
			}
			message += '\n';
		}

		message += `\nhttp://www.playminecraftbingo.com/fetchr-weekly-seeds/${week.week}`

		return {
			content: message,
		};
	}
}

