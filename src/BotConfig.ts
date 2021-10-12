import config from "config"
import { readFileSync } from "fs";

export default class BotConfig {
	public readonly trustedStreamers: Array<string>;
	public readonly ssl?: SSLConfig;
	public readonly discordToken: string;
	public readonly twitch: TwitchConfig;

	constructor() {
		this.trustedStreamers = config.get('trustedStreamers');
		this.discordToken = config.get('discordToken');
		this.twitch = config.get('twitch');

		try {
			const sslPaths = config.get<SSLConfig>('ssl');
			const certificate =  readFileSync(sslPaths.certificate, 'ascii');
			const key = readFileSync(sslPaths.key, 'ascii');
			this.ssl = {
				hostName: sslPaths.hostName,
				certificate: certificate,
				key: key
			}
		} catch {
			console.log("No ssl config found, will use ngork for twitch eventsub");
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