import { HelixStream } from "@twurple/api";
import { Client, MessageEmbed, TextChannel } from "discord.js";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import BingoBot from "./BingoBot";

export default class DiscordAnnouncer {
	private readonly client: Client
	private broadcasterToMessages: Map<string, {id: string, channelId: string}>;

	constructor(client: Client) {
		this.client = client;
		try {
			const obj = JSON.parse(readFileSync('./data/trackedMessages.json').toString('utf8'));
			this.broadcasterToMessages = new Map(Object.entries(obj));
		} catch {
			this.broadcasterToMessages = new Map<string, {id: string, channelId: string}>();
		}
	}

	public async sendStreamNotification(stream: HelixStream, channel: TextChannel, trackMessage = true): Promise<void> {
		BingoBot.logger.debug(`Sending Discord message for ${stream.userDisplayName} to ${channel.name}.`);
		const user = await stream.getUser();
		const embed = new MessageEmbed({
			color: 'PURPLE',
			title: stream.title.discordEscape(),
			url: `https://www.twitch.tv/${user.name}`
		})
		.setImage(stream.getThumbnailUrl(320, 180))
		.setThumbnail(user.profilePictureUrl)
		.addField('Language', stream.language.discordEscape(), true)
		.addField('Started', `<t:${Math.round(stream.startDate.getTime() / 1_000)}:R>`, true)
		.addField('Viewers', `${stream.viewers}`, true);
			
		const message = await channel.send({
			content: `**${user.displayName.discordEscape()}** is live playing Bingo on <https://www.twitch.tv/${user.name}>`,
			embeds: [embed]
		});

		if(trackMessage) {
			BingoBot.logger.info(`Tracking message ${message.id} for broadcaster ${user.displayName}.`);
			this.broadcasterToMessages.set(stream.userId, {id: message.id, channelId: message.channelId});
			await this.saveTrackedMessages();
		}
	}

	public get trackedBroadcasters(): string[] {
		return Array.from(this.broadcasterToMessages.keys());
	}

	public async removeStreamNotification(broadcasterId: string) {
		if(this.broadcasterToMessages.has(broadcasterId)) {
			BingoBot.logger.info(`Removing Discord message for ${broadcasterId}.`);
			const message = this.broadcasterToMessages.get(broadcasterId)!;
			const channel = (await this.client.channels.fetch(message.channelId)) as TextChannel;
			await channel.messages.delete(message.id);

			this.broadcasterToMessages.delete(broadcasterId);
			await this.saveTrackedMessages();
		}
	}

	private async saveTrackedMessages(): Promise<void> {
		if(!existsSync('./data/')) {
			await mkdir('./data/');
		}
		await writeFile('./data/trackedMessages.json', JSON.stringify(Object.fromEntries(this.broadcasterToMessages)), {flag: 'w', encoding: 'utf8'});
	}
}