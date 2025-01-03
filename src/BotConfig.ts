import config from "config"
import { readFileSync } from "fs";

export default class BotConfig {
	public readonly logLevel: 'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'mark' | 'off';
	public readonly twitchBingoStreamsChannel: string;
	public readonly weeklySeedsChannel: string;
	public readonly logChannel: string;
	public readonly errorLogChannel: string;
	public readonly ownerGuild: string;
	public readonly owner: string;
	public readonly ssl?: SSLConfig;
	public readonly discordToken: string;
	public readonly twitch: TwitchConfig;
	public readonly sqlitePath: string;

	constructor() {
		this.logLevel = config.get('logLevel');
		this.twitchBingoStreamsChannel = config.get('twitchBingoStreamsChannel');
		this.weeklySeedsChannel = config.get('weeklySeedsChannel');
		this.logChannel = config.get('logChannel');
		this.errorLogChannel = config.get('errorLogChannel');
		this.ownerGuild = config.get('ownerGuild');
		this.owner = config.get('owner');
		this.discordToken = config.get('discordToken');
		this.twitch = config.get('twitch');
		if(config.has('sqlitePath')) {
			this.sqlitePath = config.get('sqlitePath');
		} else {
			this.sqlitePath = ":memory:"
		}

		if(config.has('ssl')) {
			const sslPaths = config.get<SSLConfig>('ssl');
			const certificate =  readFileSync(sslPaths.certificate, 'ascii');
			const key = readFileSync(sslPaths.key, 'ascii');
			this.ssl = {
				hostName: sslPaths.hostName,
				certificate: certificate,
				key: key
			}
		}
	}
}

export interface SSLConfig {
	readonly hostName: string;
	readonly certificate: string
	readonly key: string
}

export interface TwitchConfig {
	readonly clientId: string
	readonly clientSecret: string
	readonly eventSubSecret: string
}