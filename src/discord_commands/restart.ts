import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import BingoBot from "../BingoBot";
import { Command } from "../CommandRegistry";

export default class RestartCommand implements Command {
	public static readonly data = new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restarts the bot.')
		.setDefaultMemberPermissions('0')
		.setContexts(InteractionContextType.Guild)

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.reply('Restarting ...')
		await BingoBot.shutdown(1);
	}
}