import config from "config"
import { readFileSync } from "fs";

export default class BotConfig {
	public readonly announcementChannel: string;
	public readonly logChannel: string;
	public readonly ownerGuild: string;
	public readonly owner: string;
	public readonly ssl?: SSLConfig;
	public readonly discordToken: string;
	public readonly twitch: TwitchConfig;

	constructor() {
		this.announcementChannel = config.get('announcementChannel');
		this.logChannel = config.get('logChannel');
		this.ownerGuild = config.get('ownerGuild');
		this.owner = config.get('owner');
		this.discordToken = config.get('discordToken');
		this.twitch = config.get('twitch');

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