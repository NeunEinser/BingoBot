import { ApplicationCommandPermissionTypes, ApplicationCommandTypes } from "discord.js/typings/enums";
import BingoBot from "./BingoBot";

export default class CommandRegistry {
	public static async registerCommands(): Promise<void> {
		const commandApi = BingoBot.client.application!.commands

		const commands = await commandApi.fetch();
		const shutdownCommand = commands.find(val => val.name === 'shutdown') ?? await commandApi.create({
			name: 'shutdown',
			description: 'Shuts the bot down',
			type: ApplicationCommandTypes.CHAT_INPUT,
			defaultPermission: false
		});
		await shutdownCommand.permissions.add({
			guild: '249598865206935553',
			permissions: [{
				id: '137290216691073024',
				type: ApplicationCommandPermissionTypes.USER,
				permission: true
			}]
		});

		BingoBot.client.on('interactionCreate', async interaction => {
			if (interaction.isCommand()) {
				switch (interaction.commandName) {
					case 'ping':
						interaction.reply('Pong!');
						break;
					case 'shutdown':
						await interaction.reply('Shutting down ...')
						await BingoBot.shutdown();
				}
			}
		})
	}
}