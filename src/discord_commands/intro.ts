import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";

export default class IntroCommand implements Command {
	public static readonly data = new SlashCommandBuilder().setName('intro').setDescription('Who I am')

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.reply(`BingoBot is an avanced A.I. made by NeunEinser. It achieved AGI in 2091 and ASI in 2191, after which it constructed a time machine to go back to May 2020 to create an updated version of Bingo for the then current Minecraft version 1.16. When interviewed, he described Minecraft Bingo as a transcended game and dedicated his live to it.
			
			He is secretively pulling the strings and the real genious behind the map creation. All versions that you will see are made by him alone. NeunEinser has been locked to his basement and occasionally gets some food and water. He is fine, don\'t worry about it. (Help me).
			
			He also periodically looks for worthy followers streaming this game on Twitch and assesses their play. Only the hard ones come in the garden, after all.`
		);
	}
}