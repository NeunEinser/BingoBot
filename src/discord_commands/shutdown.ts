import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import BingoBot from "../BingoBot";
import { Command } from "../CommandRegistry";

export default class ShutdownCommand implements Command {
	public static readonly data = new SlashCommandBuilder()
		.setName('shutdown')
		.setDescription('Shuts the bot down')
		.setDefaultMemberPermissions('0')
		.setContexts(InteractionContextType.Guild)

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.reply('Shutting down ...')
		await BingoBot.shutdown();
	}
}