import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../CommandRegistry";
import { BotContext } from "../BingoBot";

export default class StreamerCommand implements Command {
	constructor (private readonly context: BotContext) {}

	public static readonly data = new SlashCommandBuilder()
		.setName('streamer')
		.setDescription('Manages bingo streamers')
		.setDefaultMemberPermissions('0')
		.setContexts(InteractionContextType.Guild)
		.addSubcommand(ls =>
			ls.setName('list').setDescription('Lists all streamers')
		)
		.addSubcommand(add => add
			.setName('add')
			.setDescription('Adds a new streamer')
			.addStringOption(str => str.setName('streamer').setDescription('The username of the streamer').setRequired(true))
		)
		.addSubcommand(rm => rm
			.setName('remove')
			.setDescription('Removes a new streamer')
			.addStringOption(str => str.setName('streamer').setDescription('The username of the streamer').setRequired(true))
		)

	async execute(interaction: ChatInputCommandInteraction) {
		switch (interaction.options.getSubcommand()) {
			case 'add': {
				const userName = interaction.options.getString('streamer') ?? '';
				const user = await this.context.twitchClient.users.getUserByName(userName);
				if(!user) {
					await interaction.reply(`Could not find twitch user **${userName.discordEscape()}**.`);
				} else {
					const success = await this.context.twitchListener.addBroadcaster(user);

					if(success) {
						await interaction.reply(`Successfully added **${userName.discordEscape()}** as trusted bingo streamer.`);
					} else {
						await interaction.reply(`**${userName.discordEscape()}** already was in the list.`);
					}
				}
				break;
			}
			case 'remove': {
				const userName = interaction.options.getString('streamer') ?? '';
				const user = await this.context.twitchClient.users.getUserByName(userName);
				if(!user) {
					await interaction.reply(`Could not find twitch user **${userName.discordEscape()}**.`);
				} else {
					const success = await this.context.twitchListener.removeBroadcaster(user.id);

					if(success) {
						await interaction.reply(`Successfully removed **${userName.discordEscape()}** from the trusted bingo streamers.`);
					} else {
						await interaction.reply(`**${userName.discordEscape()}** did already not exist on the list.`);
					}
				}
				break;
			}
			case 'list': {
				const users = (await Promise.all(this.context.twitchListener.broadcasters.map(async u => (await this.context.twitchClient.users.getUserById(u))?.displayName)))
					.map(u => u?.discordEscape() ?? '')
					.sort((a, b) => a.localeCompare(b));
				await interaction.reply(`Currently trusted Bingo streamers:\n${users.join(',\n')}`)
				break;
			}
		}
	}
}