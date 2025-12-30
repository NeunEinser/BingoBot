import { table } from "table";
import { RecapGameTypeCloverColorOverview } from "../repositories/ScoreRepository";
import { millisToTimeStamp } from "./weekly_seeds";
import Database from "../Database";

export function getRecap(db: Database, seeds_channel_url: string, discord_id: string): { is_error: true, error_message: string } | { is_error?: false, result: string } {
	const player = db.players.getPlayerByDiscordId(discord_id);
	if (!player) {
		return { is_error: true, error_message: "Player not found" };
	}

	const date = new Date();
	date.setDate(date.getDate() + 7);
	const year = date.getUTCFullYear() - 1;
	const overview = db.scores.getRecapOverview(player.id, year);

	if (!overview || !overview.seeds) {
		return { is_error: true, error_message: `You do not have any scores registered for ${year}. The recap for ${year + 1} is not ready yet.` };
	}

	let message = `# Your Weekly Seeds ${year} Recap is ready!\n\n## Overview\n\n`
		+ `- You played **${overview.seeds}** weekly seeds!\n`
		+ `- You participated in **${overview.weeks}** weeks!\n`;
	if (overview.min_rank !== null) {
		const rank_last_digit = overview.min_rank % 10;
		message += `- You became ${overview.min_rank}${rank_last_digit == 1 ? 'st' : rank_last_digit == 2 ? 'nd' : rank_last_digit == 3 ? 'rd' : 'th'} place!\n`;
	}

	const gameTypeOverview = db.scores.getRecapGameTypeOverview(player.id, year);

	// no leaf clover
	let cloverColor: RecapGameTypeCloverColorOverview[] = [];
	if (player.id === 7) {
		cloverColor = db.scores.getRecapGameTypeCloverColor(year);
	}

	for (const gameType of gameTypeOverview) {
		const gameTypeName = `${gameType.game_type.split('_').map(x => x[0].toUpperCase() + x.substring(1)).join(" ")}${gameType.game_type === 'points' ? " In 25 Minutes" : ""}`;
		message += `\n## ${gameTypeName} (${gameType.practiced ? 'practiced' : 'blind'})\n`
			+ `- You played ${gameType.count} seeds of this type\n`
			+ `- You averaged ${gameType.average_points !== null ? gameType.average_points.toFixed(2) : millisToTimeStamp(gameType.average_time ? Math.floor(gameType.average_time): gameType.average_time, true)}${gameType.average_points !== null ? " points" : ""}\n`;
		if (gameType.average_rank !== null) {
			message += `- Your average rank was ${gameType.average_rank.toFixed(2)}\n`;
		}

		const bestPerformance = db.scores.getRecapGameTypeBest(player.id, gameType.game_type, gameType.practiced, year);
		if (bestPerformance !== null) {
			message += `\n### Your fastest ${gameTypeName} game:\n`;
				+ `${seeds_channel_url}${bestPerformance.seed.discord_message_id}\n`;
			if (bestPerformance.rank !== null) {
				const rank_last_digit = bestPerformance.rank % 10;
				message += `${bestPerformance.rank}${rank_last_digit == 1 ? 'st' : rank_last_digit == 2 ? 'nd' : rank_last_digit == 3 ? 'rd' : 'th'} place -- `;
			}
			if (bestPerformance.points !== null) {
				message += `${bestPerformance.points} points${bestPerformance.time_in_millis !== null ? ` (${millisToTimeStamp(bestPerformance.time_in_millis)})` : ""}`;
			} else {
				message += millisToTimeStamp(bestPerformance.time_in_millis);
			}
			message += "\n";
			if (bestPerformance.description?.trim()) {
				message += `You said “${bestPerformance.description}”\n`;
			}
		}

		// no leaf clover color stuff
		const colorData = cloverColor
			.filter(x => x.game_type === gameType.game_type && x.practiced === gameType.practiced)
			.map(x => [
				x.description,
				x.count,
				x.average_rank?.toFixed(2),
				x.average_points !== null ? x.average_points.toFixed(2) : millisToTimeStamp(Math.floor(x.average_time!), true),
			])
		if (colorData.length > 0) {
			colorData.unshift(["Color", "Count", "Average Rank", "Average Score"])
			const colorTable = table(colorData, {
				columns: { 1: { alignment: 'right' }, 2: { alignment: 'right' }, 3: { alignment: 'right' } },
				drawHorizontalLine: i => i < 2 || i === colorData.length
			})
			message += `\n### Clover-Special!\n\`\`\`\n${colorTable}\n\`\`\``
		}
	}

	message += "\n-# You may use `/recap` on the NeunEinser discord server to share your recap."

	return { result: message }
}