import { TextChannel } from "discord.js";
import { Config, LayoutFunction, LayoutsParam, LoggingEvent } from "log4js";

// This is the function that generates an appender function
function stdoutAppender(layout: LayoutFunction, config: DiscordAppenderConfig) {
	const channel = config.getChannel();
	return async (loggingEvent: LoggingEvent) => {
		await channel.send(layout(loggingEvent).discordEscape());
	};
}

export function configure(config: DiscordAppenderConfig, layouts: LayoutsParam) {
	const layout = layouts.basicLayout;
	return stdoutAppender(layout, config);
}

interface DiscordAppenderConfig extends Config {
	getChannel: () => TextChannel
}