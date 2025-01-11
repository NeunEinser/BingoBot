import { AttachmentBuilder, Channel, TextChannel } from "discord.js";
import { Config, LayoutFunction, LayoutsParam, LoggingEvent } from "log4js";

// This is the function that generates an appender function
function stdoutAppender(layout: LayoutFunction, config: DiscordAppenderConfig) {
	const channel = config.getChannel();
	if (!channel?.isSendable()) {
		return;
	}
	return async (loggingEvent: LoggingEvent) => {
		let toSend = layout(loggingEvent);
		let attachmentStr: string | undefined = undefined;
		let start = 0;

		while(!attachmentStr && start < toSend.length) {
			const arrayStart = toSend.indexOf("\n[");
			const objectStart = toSend.indexOf("\n{");
			start = toSend.length;
			if (arrayStart >= 0) {
				start = arrayStart;
			}
			if (objectStart >= 0 && objectStart < start) {
				start = objectStart;
			}
			const jsonStr = toSend.substring(start).trim();
			if (jsonStr) {
				try {
					JSON.parse(jsonStr);
					attachmentStr = jsonStr;
					toSend = toSend.substring(0, start).trim();
				} catch {}
			}
		}

		while (toSend.length > 0) {
			let end = toSend.length > 1992
				? toSend.lastIndexOf('\n', 1992)
				: toSend.length;
			if (end < 1) {
				end = 1992;
			}
			if (attachmentStr && end >= toSend.length) {
				const attachment = new AttachmentBuilder(Buffer.from(attachmentStr)).setName('log.json');
				await channel.send({ content: `\`\`\`\n${toSend.substring(0, end)}\n\`\`\``, files: [attachment] });
			} else {
				await channel.send(`\`\`\`\n${toSend.substring(0, end)}\n\`\`\``);
			}
			toSend = toSend.substring(end);
		}
	};
}

export function configure(config: DiscordAppenderConfig, layouts: LayoutsParam) {
	const layout = layouts.basicLayout;
	return stdoutAppender(layout, config);
}

interface DiscordAppenderConfig extends Config {
	getChannel: () => Channel | undefined
}