import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";

export default class PingCommand implements Command {
	public static readonly data = new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Checks if the bot is responsive')
		.addIntegerOption(delay => delay
			.setName("delay")
			.setDescription("Delay in miliseconds")
			.setMinValue(0)
			.setMaxValue(600_000)
			.setRequired(false)
		);

	async execute(interaction: ChatInputCommandInteraction) {
		const delay = interaction.options.getInteger("delay");
		if (delay) {
			await interaction.deferReply();
			await new Promise(resolve => setTimeout(resolve, delay));
			await interaction.editReply("Pong!");
		} else {
			await interaction.reply("Pong!");
		}
	}
}