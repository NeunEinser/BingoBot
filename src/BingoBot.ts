import config from "config";
import { Client, Intents, TextChannel } from "discord.js";
import CommandRegistry from "./CommandRegistry";
import DiscordAnnouncer from "./DiscordAnnouncer";
import TwitchStreamListener from "./TwitchStreamListener";

export default class BingoBot {
	public static readonly client : Client = new Client({intents: Intents.FLAGS.GUILD_MESSAGES });
	private static twitchListener: TwitchStreamListener;

	public static async start(): Promise<void> {
		
		const token = config.get<string>('discordToken');
		await this.client.login(token);

		const channel = (await this.client.channels.fetch('896466836214906910')) as TextChannel;
		const untrustedChannel = (await this.client.channels.fetch('896511765272199208')) as TextChannel;

		this.twitchListener = new TwitchStreamListener(
			config.get('twitch.clientId'),
			config.get('twitch.clientSecret'),
			config.get('twitch.eventSubSecret'),
			config.get('trustedStreamers')
		);
		
		const discordAnnouncer = new DiscordAnnouncer();

		this.twitchListener.onTrustedBingoStreamWentLive(async stream => {
			await discordAnnouncer.sendStreamNotification(stream, channel);
		});
		
		this.twitchListener.onUntrustedBingoStreamWentLive(async stream => {
			await discordAnnouncer.sendStreamNotification(stream, untrustedChannel, false);
		});
		
		this.twitchListener.onStreamerWentOffline(async broadcasterId => {
			await discordAnnouncer.removeStreamNotification(broadcasterId);
		});

		this.twitchListener.start();

		CommandRegistry.registerCommands()

		process.on('exit', async _ => {
			await this.shutdown()
		});

	}

	public static async shutdown(): Promise<void> {
		this.client.destroy();
		await this.twitchListener.destroy();

		process.exit(1);
	}
}