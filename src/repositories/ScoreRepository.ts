import { DatabaseSync, StatementSync } from "node:sqlite";
import SeedRepository, { GAME_TYPES, GameType, gameTypeFromInt, Seed } from "./SeedRepository";
import PlayerRepository, { Player } from "./PlayerRepository";
import { createMapper, filterMap, TypeMap } from "../util/type_utils";

const URL_TYPES = Object.freeze(
	['image', 'video'] as const
)

export type UrlType = (typeof URL_TYPES)[number]

export interface Score {
	rank: number | null;
	seed: Seed;
	player: Player;
	points: number | null;
	time_in_millis: number | null;
	url_type: UrlType | null;
	url: string | null;
	submitted_at: Date;
	description: string | null;
}

export interface RecapOverview {
	seeds: number | null;
	weeks: number | null;
	min_rank: number | null;
}

export interface RecapGameTypeOverview {
	game_type: GameType;
	practiced: boolean;
	count: number;
	average_points: number | null;
	average_time: number | null;
	average_rank: number | null;
}

export interface RecapGameTypeCloverColorOverview extends RecapGameTypeOverview {
	description: string;
}

const SCORE_TYPE_MAP = Object.freeze(
	{
		rank: [ 'number', 'null' ],
		seed: [ (raw, prefix) => SeedRepository.mapSeed(raw, prefix) ],
		player: [ (raw, prefix) => PlayerRepository.mapPlayer(raw, prefix) ],
		points: [ 'number', 'null' ],
		time_in_millis: [ 'number', 'null' ],
		url_type: [ (v) => (typeof v === 'number') ? (URL_TYPES[v] ?? null) : null, 'null' ],
		url: [ 'string', 'null' ],
		submitted_at: [ 'Date' ],
		description: [ 'string', 'null' ],
	} satisfies TypeMap<Score>);

const RANK_SELECT = `CASE
	WHEN score.url_type = 1
	THEN (
		SELECT COUNT(*) + 1
		FROM player_scores x
			JOIN players xp ON x.player_id = xp.id
		WHERE x.seed_id = seed.id
			AND x.url_type = 1
			AND xp.in_game_name NOT NULL
			AND (
				(
					seed.game_type = 6
					AND (
						x.points > score.points
						OR (
							x.points = score.points
							AND x.time_in_millis NOT NULL 
							AND (score.time_in_millis ISNULL OR x.time_in_millis < score.time_in_millis)
						)
					)
				)
				OR (
					seed.game_type != 6
					AND x.time_in_millis NOT NULL 
					AND (score.time_in_millis ISNULL OR x.time_in_millis < score.time_in_millis)
				)
			)
	)
	ELSE NULL
END`

const DEFAULT_QUERY = `SELECT
	${RANK_SELECT} rank,
	score.points,
	score.time_in_millis,
	score.url_type,
	score.url,
	score.submitted_at,
	score.description,
	player.id player__id,
	player.in_game_name player__in_game_name,
	player.discord_id player__discord_id,
	seed.id seed__id,
	seed.seed seed__seed,
	seed.practiced seed__practiced,
	seed.game_type seed__game_type,
	seed.game_type_specific seed__game_type_specific,
	seed.discord_message_id seed__discord_message_id,
	seed.description seed__description,
	week.id seed__week__id,
	week.week seed__week__week,
	version.major || '.' || version.minor || '.' || version.patch seed__week__version,
	mc_version.major || '.' || mc_version.minor || '.' || mc_version.patch seed__week__mc_version,
	max_version.major || '.' || max_version.minor || '.' || max_version.patch seed__week__max_version,
	max_mc_version.major || '.' || max_mc_version.minor || '.' || max_mc_version.patch seed__week__max_mc_version,
	week.published_on_unix_millis seed__week__published_on_unix_millis,
	week.discord_message_id seed__week__discord_message_id,
	week.description seed__week__description
FROM player_scores score
	JOIN players player ON score.player_id = player.id
	JOIN seeds seed ON score.seed_id = seed.id
	JOIN weeks week ON seed.week_id = week.id
	JOIN versions version ON week.version_id = version.id
	JOIN minecraft_versions mc_version ON week.minecraft_version_id = mc_version.id
	LEFT JOIN versions max_version ON week.max_version_id = max_version.id
	LEFT JOIN minecraft_versions max_mc_version ON week.max_minecraft_version_id = max_mc_version.id`

export default class ScoreRepository {
	private readonly getPlayerScoreQuery: StatementSync;
	private readonly getPlayerScoresByPlayerQuery: StatementSync;
	private readonly getPlayerScoresByPlayerAndWeekQuery: StatementSync;
	private readonly getPlayerScoresBySeedQuery: StatementSync;
	private readonly createOrUpdatePlayerScoreQuery: StatementSync;
	private readonly deletePlayerScoreQuery: StatementSync;
	private readonly recapPlayersQuery: StatementSync;
	private readonly recapOverviewQuery: StatementSync;
	private readonly recapGameTypeOverviewQuery: StatementSync;
	private readonly recapGameTypeBestQuery: StatementSync;
	private readonly recapGameTypeCloverColorQuery: StatementSync;

	constructor(
		db: DatabaseSync,
	) {
		this.getPlayerScoreQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE player.id = ? AND seed.id = ?
			ORDER BY week.published_on_unix_millis DESC
		`);
		this.getPlayerScoresByPlayerQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE player.id = ?
			ORDER BY week.published_on_unix_millis DESC
			LIMIT ?
		`);
		this.getPlayerScoresByPlayerAndWeekQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE player.id = ? AND week.id = ?
			ORDER BY seed.seed DESC
			LIMIT ?
		`);
		this.getPlayerScoresBySeedQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE seed.id = ? AND player.in_game_name NOT NULL
			ORDER BY
				score.points DESC,
				CASE WHEN score.time_in_millis NOT NULL THEN 0 ELSE 1 END,
				score.time_in_millis
			LIMIT ?
		`);
		this.createOrUpdatePlayerScoreQuery = db.prepare(`INSERT OR REPLACE
			INTO player_scores(player_id, seed_id, points, time_in_millis, url_type, url, description)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);
		this.deletePlayerScoreQuery = db.prepare('DELETE FROM player_scores WHERE player_id = ? AND seed_id = ?');
		
		this.recapPlayersQuery = db.prepare(`SELECT DISTINCT
				player.discord_id
			FROM player_scores score
				JOIN players player ON player.id = score.player_id
				JOIN seeds seed ON seed.id = score.seed_id
				JOIN weeks week ON week.id = seed.week_id
			WHERE CAST(strftime('%Y', week.published_on_unix_millis / 1000, 'unixepoch') AS int) = ?`);
		this.recapOverviewQuery = db.prepare(`SELECT
				COUNT(*) seeds,
				COUNT(DISTINCT seed.week_id) weeks,
				MIN(${RANK_SELECT}) min_rank
			FROM player_scores score
				JOIN seeds seed ON seed.id = score.seed_id
				JOIN weeks week ON week.id = seed.week_id
			WHERE score.player_id = ?
				AND CAST(strftime('%Y', week.published_on_unix_millis / 1000, 'unixepoch') AS int) = ?`);
		this.recapGameTypeOverviewQuery = db.prepare(`SELECT
				seed.game_type,
				seed.practiced,
				COUNT(*) count,
				AVG(score.points) average_points,
				AVG(score.time_in_millis) average_time,
				AVG(${RANK_SELECT}) average_rank
			FROM player_scores score
				JOIN seeds seed ON seed.id = score.seed_id
				JOIN weeks week ON week.id = seed.week_id
			WHERE score.player_id = ?
				AND CAST(strftime('%Y', week.published_on_unix_millis / 1000, 'unixepoch') AS int) = ?
			GROUP BY seed.game_type, seed.practiced
			ORDER BY seed.practiced, seed.game_type`);
		this.recapGameTypeBestQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE score.player_id = ?
				AND seed.game_type = ?
				AND seed.practiced = ?
				AND CAST(strftime('%Y', week.published_on_unix_millis / 1000, 'unixepoch') AS int) = ?
			ORDER BY
				score.points DESC, 
				CASE WHEN score.time_in_millis NOT NULL THEN 0 ELSE 1 END,
				score.time_in_millis ASC
			LIMIT 1`);
		this.recapGameTypeCloverColorQuery = db.prepare(`SELECT
				seed.game_type,
				seed.practiced,
				score.description,
				COUNT(*) count,
				AVG(score.points) average_points,
				AVG(score.time_in_millis) average_time,
				AVG(${RANK_SELECT}) average_rank
			FROM player_scores score
				JOIN seeds seed ON seed.id = score.seed_id
				JOIN weeks week ON week.id = seed.week_id
			WHERE score.player_id = 7
				AND score.description NOT NULL
				AND CAST(strftime('%Y', week.published_on_unix_millis / 1000, 'unixepoch') AS int) = ?
			GROUP BY seed.game_type, seed.practiced, score.description
			ORDER BY
				seed.practiced,
				seed.game_type,
				average_points DESC,
				CASE WHEN average_time NOT NULL THEN 0 ELSE 1 END,
				average_time`);
	}

	public getPlayerScore(player_id: number, seed_id: number) {
		return ScoreRepository.mapScore(this.getPlayerScoreQuery.get(player_id, seed_id));
	}

	public getPlayerScoresByPlayer(player_id: number, maxResults: number) {
		return filterMap(this.getPlayerScoresByPlayerQuery.all(player_id, maxResults), ScoreRepository.mapScore);
	}

	public getPlayerScoresByPlayerAndWeek(player_id: number, week_id: number, maxResults: number) {
		return filterMap(this.getPlayerScoresByPlayerAndWeekQuery.all(player_id, week_id, maxResults), ScoreRepository.mapScore);
	}

	public getPlayerScoresBySeed(seed_id: number, maxResults: number) {
		return filterMap(this.getPlayerScoresBySeedQuery.all(seed_id, maxResults), ScoreRepository.mapScore);
	}

	public getRecapPlayers(year: number) {
		return filterMap(this.recapPlayersQuery.all(year), ScoreRepository.mapRecapPlayers);
	}
	public getRecapOverview(player_id: number, year: number) {
		return ScoreRepository.mapRecapOverview(this.recapOverviewQuery.get(player_id, year));
	}

	public getRecapGameTypeOverview(player_id: number, year: number) {
		return filterMap(
			this.recapGameTypeOverviewQuery.all(player_id, year),
			ScoreRepository.mapRecapGameTypeOverview
		);
	}

	public getRecapGameTypeBest(player_id: number, game_type: GameType, practiced: boolean, year: number) {
		return ScoreRepository.mapScore(this.recapGameTypeBestQuery.get(
			player_id,
			GAME_TYPES.indexOf(game_type),
			practiced ? 1 : 0,
			year
		));
	}

	public getRecapGameTypeCloverColor(year: number) {
		return filterMap(
			this.recapGameTypeCloverColorQuery.all(year),
			ScoreRepository.mapRecapGameTypeCloverColorOverview
		);
	}

	public createOrUpdatePlayerScore(seed_id: number, player_id: number, points: number | null, time_in_millis: number | null, url_type?: UrlType | null, url?: string | null, description?: string | null) {
		this.createOrUpdatePlayerScoreQuery.run(
			player_id,
			seed_id,
			points,
			time_in_millis,
			url_type ? URL_TYPES.indexOf(url_type) : null,
			url ?? null,
			description ?? null,
		);
	}

	public deleteScore(player_id: number, seed_id: number) {
		this.deletePlayerScoreQuery.run(player_id, seed_id);
	}

	public static mapScore = createMapper<Score>(SCORE_TYPE_MAP);
	public static mapRecapPlayers = createMapper<{discord_id: string}>({
		discord_id: ["string"]
	})
	public static mapRecapOverview = createMapper<RecapOverview>({
		seeds: [ "number", "null" ],
		weeks: [ "number", "null" ],
		min_rank: [ "number", "null" ],
	});
	public static mapRecapGameTypeOverview = createMapper<RecapGameTypeOverview>({
		game_type: [ gameTypeFromInt ],
		practiced: [ "boolean" ],
		count: [ "number" ],
		average_rank: [ "number", "null" ],
		average_points: [ "number", "null" ],
		average_time: [ "number", "null" ],
	});
	public static mapRecapGameTypeCloverColorOverview = createMapper<RecapGameTypeCloverColorOverview>({
		game_type: [ gameTypeFromInt ],
		practiced: [ "boolean" ],
		description: [ "string" ],
		count: [ "number" ],
		average_rank: [ "number", "null" ],
		average_points: [ "number", "null" ],
		average_time: [ "number", "null" ],
	});
}