import * as log4js from 'log4js';
import { ApiClient } from "@twurple/api";
import { AppTokenAuthProvider } from '@twurple/auth';
import { Client, IntentsBitField, NewsChannel, TextChannel } from "discord.js";
import BotConfig from "./BotConfig";
import CommandRegistry from "./CommandRegistry";
import DiscordAnnouncer from "./DiscordAnnouncer";
import TwitchStreamListener from "./TwitchStreamListener";

export default class BingoBot {
	private static readonly client : Client = new Client({intents: IntentsBitField.Flags.GuildMessages | IntentsBitField.Flags.Guilds});
	public static readonly config = new BotConfig();
	public static readonly logger = log4js.getLogger('BingoBot');

	private static twitchListener: TwitchStreamListener;

	public static async start(): Promise<void> {
		try {
			await this.client.login(this.config.discordToken);
			
			const auth = new AppTokenAuthProvider(this.config.twitch.clientId, this.config.twitch.clientSecret);
			const twitchClient = new ApiClient({authProvider: auth, });

			const announcementChannel = (await this.client.channels.fetch(this.config.announcementChannel)) as NewsChannel;
			const logChannel = (await this.client.channels.fetch(this.config.logChannel)) as TextChannel;
			
			log4js.configure({
				appenders: {
					out: { type: 'stdout' },
					file: { type: 'file', filename: `logs/${new Date().toISOString().replace(/[:.]/g, '_')}.log` },
					discord: { type: 'DiscordAppender', getChannel: () => logChannel }
				},
				categories: {
					default: { appenders: [ 'out', 'file', 'discord' ], level: this.config.logLevel }
				}
			});
			this.logger.info('Initializing bot');

			this.twitchListener = new TwitchStreamListener(twitchClient);
			
			const discordAnnouncer = new DiscordAnnouncer(this.client);

			this.twitchListener.onTrustedBingoBroadcastWentLive(async stream => {
				try {
					await discordAnnouncer.sendStreamNotification(stream, announcementChannel);
					await discordAnnouncer.sendStreamNotification(stream, logChannel, false, '(already trusted)');
				} catch (err) {
					BingoBot.logger.error(err);
				}
			});
			
			this.twitchListener.onUntrustedBingoBroadcastWentLive(async stream => {
				try {
					await discordAnnouncer.sendStreamNotification(stream, logChannel, false, '(untrusted)');
				} catch (err) {
					BingoBot.logger.error(err);
				}
			});
			
			this.twitchListener.onBroadcasterWentOffline(async broadcasterId => {
				try {
					await discordAnnouncer.removeStreamNotification(broadcasterId);
				} catch (err) {
					BingoBot.logger.error(err);
				}
			});

			const commands = new CommandRegistry(this.client, twitchClient, this.twitchListener);
			await commands.registerCommands();
			await this.twitchListener.start();

			this.logger.info('Successfully started bot.')

		} catch (err) {
			this.logger.fatal(err);
			this.client?.destroy();
			await this.twitchListener?.destroy();
			log4js?.shutdown();
			process.exit(-1);
		}
	}

	public static async shutdown(): Promise<void> {
		this.client.destroy();
		await this.twitchListener.destroy();
		log4js.shutdown();

		process.exit(0);
	}
}