import { SlashCommandBuilder } from '@discordjs/builders';
import { ApiClient } from '@twurple/api';
import { Client } from 'discord.js';
import BingoBot from './BingoBot';
import TwitchStreamListener from './TwitchStreamListener';

export default class CommandRegistry {
	private readonly discordClient: Client;
	private readonly twitchClient: ApiClient;
	private readonly twitchListener: TwitchStreamListener;

	constructor(discordClient: Client, twitchClient: ApiClient, twitchListener: TwitchStreamListener) {
		this.discordClient = discordClient;
		this.twitchClient = twitchClient
		this.twitchListener = twitchListener
	}

	public async registerCommands(): Promise<void> {
		const commandApi = this.discordClient.application!.commands

		const commandDefs = [
			new SlashCommandBuilder().setName('ping').setDescription('Checks if the bot is responsive'),
			new SlashCommandBuilder().setName('intro').setDescription('Who I am'),
			new SlashCommandBuilder().setName('shutdown').setDescription('Shuts the bot down').setDefaultPermission(false),
			new SlashCommandBuilder().setName('streamer').setDescription('Manages bingo streamers').setDefaultPermission(false)
				.addSubcommand(sub =>
					sub.setName('list').setDescription('Lists all streamers')
				)
				.addSubcommand(sub =>
					sub.setName('add').setDescription('Adds a new streamer')
						.addStringOption(str => str.setName('streamer').setDescription('The username of the streamer').setRequired(true))
				)
				.addSubcommand(sub =>
					sub.setName('remove').setDescription('Removes a new streamer')
						.addStringOption(str => str.setName('streamer').setDescription('The username of the streamer').setRequired(true))
				)
		]
		await commandApi.set(commandDefs.map(d => d.toJSON()));

		this.discordClient.on('interactionCreate', async interaction => {
			try {
				if (interaction.isCommand()) {
					BingoBot.logger.info(`Received command ${interaction.commandName}\n${JSON.stringify(interaction.options.data)}`);
					switch (interaction.commandName) {
						case 'ping':
							await interaction.reply('Pong!');
							break;
						case 'intro':
							await interaction.reply('I am an awesome Discord bot announcing Bingo streams developed by the best developer of all time.');
							break;
						case 'shutdown':
							await interaction.reply('Shutting down ...')
							await BingoBot.shutdown();
							break;
						case 'streamer':
							switch (interaction.options.data[0].name)
							{
								case 'add': {
									const userName = interaction.options.getString('streamer') ?? '';
									const user = await this.twitchClient.users.getUserByName(userName);
									if(!user) {
										await interaction.reply(`Could not find twitch user **${userName.discordEscape()}**.`);
									} else {
										const success = await this.twitchListener.addBroadcaster(user);

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
									const user = await this.twitchClient.users.getUserByName(userName);
									if(!user) {
										await interaction.reply(`Could not find twitch user **${userName.discordEscape()}**.`);
									} else {
										const success = await this.twitchListener.removeBroadcaster(user.id);

										if(success) {
											await interaction.reply(`Successfully removed **${userName.discordEscape()}** from the trusted bingo streamers.`);
										} else {
											await interaction.reply(`**${userName.discordEscape()}** did already not exist on the list.`);
										}
									}
									break;
								}
								case 'list': {
									const users = (await Promise.all(this.twitchListener.broadcasters.map(async u => (await this.twitchClient.users.getUserById(u))?.displayName)))
										.map(u => u?.discordEscape() ?? '')
										.sort((a, b) => a.localeCompare(b));
									await interaction.reply(`Currently trusted Bingo streamers:\n${users.join(',\n')}`)
									break;
								}
							}
						}
				}
			} catch (err) {
				try {
					BingoBot.logger.error(err);
					if(interaction.isCommand() && !interaction.replied)
						await interaction.reply("Command execution failed");
				} catch (_) {}
			}
		});
	}
}