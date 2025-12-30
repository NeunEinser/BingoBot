import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import BotConfig from "../BotConfig";
import { splitMessage } from "../util/discord_util";
import { getRecap } from "../util/recap";

export default class RecapCommand implements Command {
	constructor(private readonly context: BotContext, private readonly config: BotConfig) {}

	public static readonly data = new SlashCommandBuilder()
		.setName("recap")
		.setDescription("Gets the user's recap");

	async execute(interaction: ChatInputCommandInteraction) {
		const result = getRecap(this.context.db, (await this.context.discordClient.channels.fetch(this.config.weeklySeedsChannel))!.url, interaction.user.id)

		if (result.is_error) {
			await interaction.reply(result.error_message);
			return;
		}

		const split = splitMessage(result.result);
		for (const part of split) {
			if (interaction.replied) {
				await interaction.followUp(part.trim());
			} else {
				await interaction.reply(part.trim());
			}
		}
	}
}