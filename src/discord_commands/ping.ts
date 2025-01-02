import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";

export default class PingCommand implements Command {
	public static readonly data = new SlashCommandBuilder().setName('ping').setDescription('Checks if the bot is responsive');

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.reply("Pong!");
	}
}