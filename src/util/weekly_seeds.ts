import { BaseMessageOptionsWithPoll } from "discord.js";
import { table } from "table";
import { BotContext } from "../BingoBot";
import BotConfig from "../BotConfig";
import { Seed } from "../repositories/SeedRepository";
import { Week } from "../repositories/WeekRepository";

export async function constructDiscordMessageAndUpdateIfExists(week: Week, context: BotContext, config: BotConfig): Promise<BaseMessageOptionsWithPoll> {
	const fetchrVersionStr = week.version.toString() + (week.max_version ? '-' + week.max_version.toString() : '');
	const mcVersionStr = week.mc_version.toString() + (week.max_mc_version ? '-' + week.max_mc_version.toString() : '');
	const seeds = context.db.seeds.getSeedsByWeekId(week.id);
	const publishedOn = week.published_on ?? new Date();
	const toFri = (publishedOn.getDay() + 2) % 7;
	const date = new Date(publishedOn);
	date.setDate(date.getDate() - toFri);

	let message = '';
	if (week.description) {
		message += week.description + '\n\n';
	}
	message += `Fetchr ${fetchrVersionStr} (MC ${mcVersionStr}) seeds for ${date.toLocaleDateString('en-us', { month: 'long', day: 'numeric', year: 'numeric' })}:\n\n`;
	
	const posted = new Set<number>();

	for (let seed of seeds) {
		if (posted.has(seed.seed)) {
			continue;
		}
		posted.add(seed.seed);

		message += 'weekly '
		if (!seed.practiced) {
			message += 'blind '

			message += seed.game_type.replace('_', '-');
			if (seed.game_type === 'points') {
				message += `-in-${seed.game_type_specific}-mins`;
			}
		} else {
			message += 'practiced';
		}

		message += ` seed: ${seed.seed}`;
		if (seed.description) {
			message += ` (${seed.description})`;
		}
		message += '\n';
	}

	message += `\nhttp://www.playminecraftbingo.com/fetchr-weekly-seeds/${week.week}\n\n-# Use /score to submit your scores!\n\n`

	if (!week.published_on && !week.discord_message_id) {
		for (let seed of seeds) {
			if (!seed.discord_message_id) {
				message += (await updateMessageForSeed(seed, context, config)).content + '\n\n';
			}
		}
	}

	const messageOptions: BaseMessageOptionsWithPoll = {
		content: message.trim().substring(0, 2000),
	};

	if (week.discord_message_id) {
		const channel = await context.discordClient.channels.fetch(config.weeklySeedsChannel);
		if (channel?.isTextBased()) {
			await channel.messages.edit(week.discord_message_id, messageOptions);
		}
	}

	return messageOptions;
}

export async function updateMessageForSeed(seed: Seed, context: BotContext, config: BotConfig): Promise<BaseMessageOptionsWithPoll> {
	let message = '';

	message += `**${seed.seed}** (${seed.practiced ? 'practiced' : 'blind'} ${seed.game_type.replace('_', '-')}`;
	if (seed.game_type === 'points') {
		message += `-in-${seed.game_type_specific}-mins`;
	}
	message += '): \n';

	const scores = context.db.scores.getPlayerScoresBySeed(seed.id, 10);

	const table_data = scores.map(s => [
		s.rank ?? '-',
		s.player.in_game_name,
		seed.game_type === 'points'
			? s.points
				+ (
					s.time_in_millis
					&& scores.some(x => x.player.id !== s.player.id && x.points === s.points)
					? ` (${millisToTimeStamp(s.time_in_millis)})`
					: ''
				)
			: millisToTimeStamp(s.time_in_millis!),
		s.url_type ?? '-'
	]);

	table_data.unshift([ 'Rank', 'Player', 'Score', 'Link' ]);
	if (table_data.length === 1) {
		table_data.push([ '-', '-', '-', '-' ]);
	}

	const str_table = table(table_data, {
		columns: { 0: { alignment: 'right' }, 2: { alignment: 'right' } },
		border: {
			topJoin: '`\u200B`╤`\u200B`',
			topLeft: '`╔`\u200B`',
			topRight: '`\u200B`╗`',
	
			bottomJoin: '`\u200B`╧`\u200B`',
			bottomLeft: '`╚`\u200B`',
			bottomRight: '`\u200B`╝`',
	
			bodyLeft: '`║`\u200B`',
			bodyRight: '`\u200B`║`',
			bodyJoin: '`\u200B`│`\u200B`',
	
			joinLeft: '`╟`\u200B`',
			joinRight: '`\u200B`╢`',
			joinJoin: '`\u200B`┼`\u200B`',
		},
		drawHorizontalLine: i => i < 2 || i === table_data.length
	})

	message += str_table
		.split('\n')
		.map((v, i) => {
			if (i === 1) {
				return v.replace(/`\s+[^` ]+\s+`/g, '**$&**');
			} else if (i > 2 && i < scores.length + 3) {
				const score = scores[i - 3];
				if (!score.rank) {
					v = v.replace(/`\s+[^` ]+\s+`/g, '_$&_');
				}
				return v.replace(/`\s+(?:image|video)\s+`/, `**[$&](<${score.url}>)**`)
			}
			return v;
		})
		.join('\n');

	const messageOptions: BaseMessageOptionsWithPoll = {
		content: message.trim(),
	};

	if (seed.discord_message_id) {
		const channel = await context.discordClient.channels.fetch(config.weeklySeedsChannel);
		if (channel?.isTextBased()) {
			await channel.messages.edit(seed.discord_message_id, messageOptions);
		}
	}

	return messageOptions;
}

function millisToTimeStamp(millis: number) {
	let cur = Math.floor(millis / 10);
	let result = '';
	if (cur % 100 !== 0) {
		result = '.' + cur % 100;
	}
	cur -= cur % 100;
	cur /= 100;

	result = (cur % 60) + result;
	if (cur >= 60) {
		if (cur % 60 < 10) {
			result = '0' + result;
		}
		result = ':' + result;
	}
	cur -= cur % 60;
	cur /= 60;
	if (cur > 0) {
		result = (cur % 60) + result;
		if (cur >= 60) {
			if (cur % 60 < 10) {
				result = '0' + result;
			}
			result = ':' + result;
			cur -= cur % 60;
			cur /= 60;
			result = cur + result;
		}
	}

	return result;
}