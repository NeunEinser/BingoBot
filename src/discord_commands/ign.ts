import { ChatInputCommandInteraction, ModalSubmitInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import { constructAndUpdateSeedMessage } from "../util/weekly_seeds";
import BotConfig from "../BotConfig";

export default class IgnCommand implements Command {
	constructor(private readonly context: BotContext, private readonly config: BotConfig) {}

	public static readonly data = new SlashCommandBuilder()
		.setName('ign')
		.setDescription('Registers your in-game name with the bot.')
		.addStringOption(ign => ign
			.setName('ign')
			.setDescription('Your in-game-name')
			.setMinLength(3)
			.setMaxLength(16)
			.setRequired(true)
		)

	async execute(interaction: ChatInputCommandInteraction) {
		const ign = interaction.options.getString('ign', true);
		await this.handle(interaction, ign);
	}

	async handleModalSubmit(interaction: ModalSubmitInteraction) {
		const ign = interaction.fields.getTextInputValue('ign');
		await this.handle(interaction, ign);
	}

	private async handle(interaction: ChatInputCommandInteraction | ModalSubmitInteraction, ign: string) {
		if (!ign.match(/^[a-zA-Z0-9_]{3,16}$/)) {
			await interaction.reply("Invalid in-game name");
			return;
		}

		let player = this.context.db.players.getPlayerByDiscordId(interaction.user.id);
		if (!player) {
			this.context.db.players.createPlayer(interaction.user.id, ign);
			player = this.context.db.players.getPlayer(this.context.db.getLastInsertRowId())!;
		} else {
			this.context.db.players.setIgn(interaction.user.id, ign);
		}
		await interaction.reply('Successfully registered in-game name. Your scores will now show up in the leaderboard!');

		const scores = this.context.db.scores.getPlayerScoresByPlayer(player.id, 100);
		for (let score of scores) {
			await constructAndUpdateSeedMessage(score.seed, this.context, this.config);
		}
	}
}