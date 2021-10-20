import BingoBot from "./BingoBot";

declare global {
	interface String {
		discordEscape(): string
	}
}
String.prototype.discordEscape = function(): string {
	return this.replace(/[\\_*~`|()[\]<>]/g, '\\$&');
}
BingoBot.start()