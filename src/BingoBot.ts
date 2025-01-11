import * as log4js from 'log4js';
import { ApiClient } from "@twurple/api";
import { AppTokenAuthProvider } from '@twurple/auth';
import { Client, IntentsBitField, NewsChannel, TextChannel } from "discord.js";
import BotConfig from "./BotConfig";
import CommandRegistry from "./CommandRegistry";
import DiscordAnnouncer from "./DiscordAnnouncer";
import TwitchStreamListener from "./TwitchStreamListener";
import { DatabaseSync } from 'node:sqlite';
import Database from './Database';

export interface BotContext {
	readonly db: Database;
	readonly discordClient: Client;
	readonly twitchClient: ApiClient;
	readonly twitchListener: TwitchStreamListener;
}

export default class BingoBot {
	private static readonly client : Client = new Client({intents: IntentsBitField.Flags.GuildMessages | IntentsBitField.Flags.Guilds});
	public static readonly config = new BotConfig();
	public static readonly logger = log4js.getLogger('BingoBot');

	private static twitchListener: TwitchStreamListener;
	private static db: Database;

	public static async start(): Promise<void> {
		try {
			this.db = new Database(new DatabaseSync(this.config.sqlitePath));
			await this.client.login(this.config.discordToken);
			
			const auth = new AppTokenAuthProvider(this.config.twitch.clientId, this.config.twitch.clientSecret);
			const twitchClient = new ApiClient({authProvider: auth, });

			const announcementChannel = (await this.client.channels.fetch(this.config.twitchBingoStreamsChannel));
			const logChannel = this.config.logChannel ? await this.client.channels.fetch(this.config.logChannel) : undefined;
			const errorLogChannel = this.config.errorLogChannel ? await this.client.channels.fetch(this.config.errorLogChannel) : undefined;
			const interactionLogChannel = this.config.interactionLogChannel ? await this.client.channels.fetch(this.config.interactionLogChannel) : undefined;
			const untrustedStreamsChannel = this.config.untrustedBingoStreamsChannel ? await this.client.channels.fetch(this.config.untrustedBingoStreamsChannel) : undefined;
			
			const appenders: Record<string, log4js.Appender> = {
				out: { type: 'stdout' },
				file: { type: 'file', filename: `logs/${new Date().toISOString().replace(/[:.]/g, '_')}.log` },
			}
			const defaultAppenders = ['out', 'file' ]
			const interactionAppendsers = []

			if (logChannel) {
				appenders.discord = { type: 'DiscordAppender', getChannel: () => logChannel };
				defaultAppenders.push('discord');
			}
			if (errorLogChannel) {
				appenders.discord_err = { type: 'DiscordAppender', getChannel: () => errorLogChannel };
				appenders.discord_err_filter = { type: 'logLevelFilter', level: 'warn', appender: 'discord_err' };
				defaultAppenders.push('discord_err_filter');
			}
			if (interactionLogChannel) {
				appenders.discord_interaction = { type: 'DiscordAppender', getChannel: () => interactionLogChannel };
				interactionAppendsers.push('discord_interaction');
			}

			log4js.configure({
				appenders,
				categories: {
					default: { appenders: defaultAppenders, level: this.config.logLevel },
					interaction: { appenders: [ ...defaultAppenders, ...interactionAppendsers ], level: this.config.logLevel }
				}
			});
			this.logger.info('Initializing bot');

			this.twitchListener = new TwitchStreamListener(twitchClient);
			
			const discordAnnouncer = new DiscordAnnouncer(this.client);

			this.twitchListener.onTrustedBingoBroadcastWentLive(async stream => {
				try {
					if (announcementChannel?.isSendable() && !announcementChannel.isDMBased()) {
						await discordAnnouncer.sendStreamNotification(stream, announcementChannel);
					}
					if (untrustedStreamsChannel?.isSendable() && !untrustedStreamsChannel.isDMBased()) {
						await discordAnnouncer.sendStreamNotification(stream, untrustedStreamsChannel, false, '(already trusted)');
					}
				} catch (err) {
					BingoBot.logger.error(err);
				}
			});
			
			this.twitchListener.onUntrustedBingoBroadcastWentLive(async stream => {
				try {
					if (untrustedStreamsChannel?.isSendable() && !untrustedStreamsChannel.isDMBased()) {
						await discordAnnouncer.sendStreamNotification(stream, untrustedStreamsChannel, false, '(untrusted)');
					}
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

			const commands = new CommandRegistry({ discordClient: this.client, twitchListener: this.twitchListener, db: this.db, twitchClient }, this.config);
			await commands.registerCommands();
			await this.twitchListener.start();

			this.logger.info('Successfully started bot.')

		} catch (err) {
			this.logger.fatal(err);
			this.shutdown(-1)
		}
	}

	public static async shutdown(exitCode: number = 0): Promise<void> {
		this.client.destroy();
		await this.twitchListener.destroy();
		log4js.shutdown();
		this.db.close();

		process.exit(exitCode);
	}
}