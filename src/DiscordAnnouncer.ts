import { HelixStream } from "@twurple/api";
import { Message, MessageEmbed, TextChannel } from "discord.js";

export default class DiscordAnnouncer {
	private broadcasterToMessageDelete = new Map<string, () => Promise<Message>>();

	public async sendStreamNotification(stream: HelixStream, channel: TextChannel, trackMessage = true): Promise<void> {
		const user = await stream.getUser();
		const embed = new MessageEmbed({
			color: 'PURPLE',
			title: stream.title,
			url: `https://www.twitch.tv/${user.name}`
		})
		.setImage(stream.getThumbnailUrl(320, 180))
		.setThumbnail(user.profilePictureUrl)
		.addField('Language', stream.language, true)
		.addField('Started', `<t:${Math.round(stream.startDate.getTime() / 1_000)}:R>`, true)
		.addField('Viewers', `${stream.viewers}`, true);
			
		const message = await channel.send({
			content: `**${user.displayName}** is live playing Bingo on https://www.twitch.tv/${user.name}`,
			embeds: [embed]
		});

		if(trackMessage)
			this.broadcasterToMessageDelete.set(stream.userId, message.delete);
	}

	public async removeStreamNotification(broadcasterId: string) {
		if(this.broadcasterToMessageDelete.has(broadcasterId)) {
			this.broadcasterToMessageDelete.get(broadcasterId)!();
			this.broadcasterToMessageDelete.delete(broadcasterId);
		}
	}
}