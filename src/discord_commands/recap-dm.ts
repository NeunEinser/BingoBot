import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, ComponentType, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";
import BotConfig from "../BotConfig";
import { getRecap } from "../util/recap";
import { splitMessage } from "../util/discord_util";
import { getLogger } from "log4js";

export default class RecapDmCommand implements Command {
	private readonly logger = getLogger('interaction');
	constructor(private readonly context: BotContext, private readonly config: BotConfig) {}

	public static readonly data = new SlashCommandBuilder()
		.setName("recap-dm")
		.setDescription("Sends the Recap to all users")
		.setDefaultMemberPermissions('0')
		.setContexts(InteractionContextType.Guild);

	async execute(interaction: ChatInputCommandInteraction) {
		const confirmBtn = new ButtonBuilder()
			.setCustomId('send-recap')
			.setLabel('Send')
			.setStyle(ButtonStyle.Primary);

		const cancelBtn = new ButtonBuilder()
			.setCustomId('cancel')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary);

		const btnRow = new ActionRowBuilder<ButtonBuilder>()
			.setComponents(cancelBtn, confirmBtn);

		const response = await interaction.reply({
			content: "Are you sure you want to send recaps to all users?",
			components: [btnRow]
		});

		try {
			const user_reply = await response.awaitMessageComponent<ComponentType.Button>({
				filter: i => i.user.id === interaction.user.id,
				time: 60_000
			});

			await user_reply.update({ components: [] });
			if (user_reply.customId !== 'send-recap') {
				await user_reply.followUp('Recap sending has been cancelled by user');
				return;
			} else {
				const date = new Date();
				date.setDate(date.getDate() + 7);
				const year = date.getUTCFullYear() - 1;
				const players = this.context.db.scores.getRecapPlayers(year);
				
				for (const player of players) {
					try {
						const result = getRecap(this.context.db, (await this.context.discordClient.channels.fetch(this.config.weeklySeedsChannel))!.url, player.discord_id)
						if (result.is_error) continue;

						const channel = await this.context.discordClient.users.createDM(player.discord_id);
						const split = splitMessage(result.result);
						for (const s of split) {
							await channel.send(s);
						}
					} catch (err) {
						this.logger.error(err);
					}
				}
				user_reply.followUp("Successfully send Recap DMs to all players.")
			}
		} catch {
			await interaction.editReply({components: [] });
			await interaction.followUp('Confirmation not recieved within a minute, cancelling');
			return;
		}
	}
}