import { ApplicationCommandPermissionTypes, ApplicationCommandTypes } from "discord.js/typings/enums";
import BingoBot from "./BingoBot";

export default class CommandRegistry {
	public static async registerCommands(): Promise<void> {
		const commandApi = BingoBot.client.application!.commands
		const ownerCommands = await BingoBot.client.guilds.resolve(BingoBot.config.ownerGuild)!.commands.fetch();
		const shutdownCommand = ownerCommands.find(val => val.name === 'shutdown') ?? await commandApi.create({
			name: 'shutdown',
			description: 'Shuts the bot down',
			type: ApplicationCommandTypes.CHAT_INPUT,
			defaultPermission: false
		});
		await shutdownCommand.permissions.add({
			guild: BingoBot.config.ownerGuild,
			permissions: [{
				id: BingoBot.config.owner,
				type: ApplicationCommandPermissionTypes.USER,
				permission: true
			}]
		});

		const commands = await commandApi.fetch();

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