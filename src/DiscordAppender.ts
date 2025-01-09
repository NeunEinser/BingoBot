import { TextChannel } from "discord.js";
import { Config, LayoutFunction, LayoutsParam, LoggingEvent } from "log4js";

// This is the function that generates an appender function
function stdoutAppender(layout: LayoutFunction, config: DiscordAppenderConfig) {
	const channel = config.getChannel();
	return async (loggingEvent: LoggingEvent) => {
		let toSend = layout(loggingEvent);
		while (toSend.length > 0) {
			let end = toSend.length > 1992
				? toSend.lastIndexOf('\n', 1992)
				: toSend.length;
			if (end < 1) {
				end = 1992;
			}
			await channel.send(`\`\`\`\n${toSend.substring(0, end)}\n\`\`\``);
			toSend = toSend.substring(end);
		}
	};
}

export function configure(config: DiscordAppenderConfig, layouts: LayoutsParam) {
	const layout = layouts.basicLayout;
	return stdoutAppender(layout, config);
}

interface DiscordAppenderConfig extends Config {
	getChannel: () => TextChannel
}