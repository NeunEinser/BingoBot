import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";

export default class ScoreCommand implements Command {
	constructor(private readonly context: BotContext) {}

	public static readonly data =	new SlashCommandBuilder()
		.setName("score")
		.setDescription("Submit a score for the weekly seeds.")
		.addSubcommand(timed => timed
			.setName("timed")
			.setDescription("Submit a score for a timed weekly seed.")
			.addIntegerOption(seed => seed
				.setName("seed")
				.setDescription("The numeric Fetchr seed")
				.setAutocomplete(true)
				.setRequired(true)
			)
			.addStringOption(time => time
				.setName("time")
				.setDescription("The time of the run formatted like is shown in Fetchr, partial seconds optional.")
				.setRequired(true)
			)
			.addStringOption(time => time
				.setName("video_url")
				.setDescription("Link to a video proving your time.")
			)
			.addStringOption(time => time
				.setName("image_url")
				.setDescription("Link to a screenshot after run completion.")
			)
		)
		.addSubcommand(points => points
			.setName("points")
			.setDescription("Submit a score for a points weekly seed.")
			.addIntegerOption(seed => seed
				.setName("seed")
				.setDescription("The numeric Fetchr seed")
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
			.addStringOption(time => time
				.setName("video_url")
				.setDescription("Link to a video proving your score.")
			)
			.addStringOption(time => time
				.setName("image_url")
				.setDescription("Link to a screenshot after run completion.")
			)
		)

	async execute(interaction: ChatInputCommandInteraction) {
		switch (interaction.options.data[0].name) {
			case 'add': {
			}
		}
	}
}