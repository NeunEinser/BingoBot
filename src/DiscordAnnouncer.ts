import { HelixStream } from "@twurple/api";
import { Client, MessageEditOptions, MessageCreateOptions, TextChannel, EmbedBuilder, Colors, NewsChannel, Message } from "discord.js";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { get } from "https";
import BingoBot from "./BingoBot";

export default class DiscordAnnouncer {
	private readonly client: Client
	private broadcasterToMessages: Map<string, SavedMessage>;

	constructor(client: Client) {
		this.client = client;
		try {
			const obj = JSON.parse(readFileSync('./data/trackedMessages.json').toString('utf8'));
			this.broadcasterToMessages = new Map(Object.entries(obj));
		} catch {
			this.broadcasterToMessages = new Map<string, SavedMessage>();
		}
	}

	public async sendStreamNotification(stream: HelixStream, channel: TextChannel | NewsChannel, trackMessage = true, logInfo = ''): Promise<void> {
		BingoBot.logger.debug(`Preparing Discord message for ${stream.userDisplayName} to ${channel.name}.`);
		const user = await stream.getUser();
		let image: string | null = stream.getThumbnailUrl(320, 180);
		if(!await this.checkThumbnail(image)) {
			image = stream.thumbnailUrl
			if(!await this.checkThumbnail(image)) {
				image = null
			}
		}
		const embed = new EmbedBuilder()
		.setTitle(stream.title.discordEscape())
		.setColor(Colors.Purple)
		.setURL(`https://www.twitch.tv/${user.name}`)
		.setThumbnail(user.profilePictureUrl)
		.addFields(
			{ name: 'Started', value: `<t:${Math.round(stream.startDate.getTime() / 1_000)}:R>`, inline: true },
			{ name: 'Viewers', value: stream.viewers.toLocaleString('en'), inline: true },
			{ name: 'Mature', value: stream.isMature ? 'Yes' : 'No', inline: true }
		)
		if(image) {
			// random query param is to avoid caching
			embed.setImage(`${image}/${Math.random()}`);
		}

		const messagePayload: MessageCreateOptions & MessageEditOptions = {
			content: `**${user.displayName.discordEscape()}** is live playing Bingo on <https://www.twitch.tv/${user.name}> ${logInfo}`,
			embeds: [embed.toJSON()]
		}
		
		let existingMessage = this.getExistingMessage(stream.userId, channel.id);
		let message: Message;

		if(!existingMessage) {
			BingoBot.logger.info(`Sending Discord message for ${stream.userDisplayName} to ${channel.name}.`);
			message = await channel.send(messagePayload);
			if(message.crosspostable)
				await message.crosspost();

		} else {
			BingoBot.logger.info(`Updating Discord message for ${stream.userDisplayName} in ${channel.name}.`);
			message = await channel.messages.fetch(existingMessage.id);
			await message.edit(messagePayload);
		}

		if(trackMessage) {
			BingoBot.logger.info(`Tracking message ${message.id} for broadcaster ${user.displayName}.`);
			const savedMessage = existingMessage ?? {id: message.id, channelId: message.channelId, start: Math.floor(Date.now() / 1_000)};
			savedMessage.end = undefined;

			this.broadcasterToMessages.set(stream.userId, savedMessage);
			await this.saveTrackedMessages();
		}
	}

	public async removeStreamNotification(broadcasterId: string) {
		BingoBot.logger.debug(`Received stream offline for ${broadcasterId}.`);
		if(this.broadcasterToMessages.has(broadcasterId)) {
			BingoBot.logger.info(`Removing Discord message for ${broadcasterId}.`);
			const savedMessage = this.broadcasterToMessages.get(broadcasterId)!;

			if(!savedMessage.end) {
				const channel = (await this.client.channels.fetch(savedMessage.channelId)) as TextChannel;
				const message = await channel.messages.fetch(savedMessage.id);

				const now = Math.floor (Date.now() / 1_000);
				const diffInHours = Math.floor((now - savedMessage.start) / 3_600);

				message.edit({ content: message.content.replace('is live', 'was live') + `\n Online Time: <t:${savedMessage.start}:f> - <t:${now}:t> (${diffInHours} hours)`, embeds: [] });

				this.broadcasterToMessages.set(broadcasterId, { ...savedMessage, end: now });
				await this.saveTrackedMessages();
			}
		}
	}

	private async saveTrackedMessages(): Promise<void> {
		if(!existsSync('./data/')) {
			await mkdir('./data/');
		}
		for (let kvp of this.broadcasterToMessages) {
			if (!DiscordAnnouncer.trackMessage(kvp[1]))
				this.broadcasterToMessages.delete(kvp[0]);
		}

		await writeFile('./data/trackedMessages.json', JSON.stringify(Object.fromEntries(this.broadcasterToMessages)), {flag: 'w', encoding: 'utf8'});
	}

	private checkThumbnail(thumbnailUrl: string): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			get(thumbnailUrl, res => {
				if (res.statusCode! >= 400) {
					resolve(false);
				} else {
					const headerLocation = res.rawHeaders.findIndex(val => val.match(/X-404-Redirect/i))
					const is404Redirect = headerLocation !== -1 && res.rawHeaders[headerLocation + 1] === 'true'
					resolve(!is404Redirect);
				}
			});
		});
	}

	private getExistingMessage(broadcasterId: string, channelId: string): SavedMessage | undefined {
		if(this.broadcasterToMessages.has(broadcasterId)) {
			const foundMessage = this.broadcasterToMessages.get(broadcasterId)!;

			// channel id doesn't match
			if(foundMessage.channelId !== channelId)
				return;

			// stream has not ended
			if(DiscordAnnouncer.trackMessage(foundMessage))
				return foundMessage;
		}
		
		return;
	}

	private static trackMessage(msg: SavedMessage) {
		if(!msg.end)
			return true;

		return Date.now() / 1_000 - msg.end <= 1_800
	}
}

interface SavedMessage {
	id: string;
	channelId: string;
	start: number;
	end?: number;
}