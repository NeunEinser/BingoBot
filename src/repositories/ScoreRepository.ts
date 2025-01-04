import { DatabaseSync, StatementSync, SupportedValueType } from "node:sqlite";
import SeedRepository, { Seed } from "./SeedRepository";
import { Player } from "./PlayerRepository";

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
	url_type: UrlType;
	url: string;
	submitted_at: Date;
	description: string | null;
}

export interface RawScore {
	rank: number | null;
	seed__id: number;
	seed__seed: number;
	seed__game_type: number,
	seed__game_type_specific: SupportedValueType;
	seed__description: string | null;
	seed__week__id: number,
	seed__week__week: number;
	seed__week__version: string;
	seed__week__max_version: string | null;
	seed__week__mc_version: string;
	seed__week__max_mc_version: string | null;
	seed__week__published_on_unix_millis?: number | null;
	seed__week__discord_message_id: string | null;
	seed__week__description: string | null;
	player__id: number;
	player__in_game_name: string;
	player__discord_id: string;
	points: number | null;
	time_in_millis: number | null;
	url_type: number;
	url: string;
	submitted_at: number;
	description: string | null;
}

const DEFAULT_QUERY = `SELECT
	CASE
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
						AND x.time_in_millis < score.time_in_millis
					)
				)
		)
		ELSE NULL
	END rank,
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
	week.description seed__week__desription
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
	}

	public getPlayerScore(player_id: number, seed_id: number) {
		const result = this.getPlayerScoreQuery.all(player_id, seed_id) as RawScore[];
		if (result.length === 0) {
			return null;
		}
		return ScoreRepository.decodeRawScore(result[0]);
	}

	public getPlayerScoresByPlayer(player_id: number, maxResults: number) {
		const result = this.getPlayerScoresByPlayerQuery.all(player_id, maxResults) as RawScore[];
		return result.map(ScoreRepository.decodeRawScore);
	}

	public getPlayerScoresByPlayerAndWeek(player_id: number, week_id: number, maxResults: number) {
		const result = this.getPlayerScoresByPlayerAndWeekQuery.all(player_id, week_id, maxResults) as RawScore[];
		return result.map(ScoreRepository.decodeRawScore);
	}

	public getPlayerScoresBySeed(seed_id: number, maxResults: number) {
		const result = this.getPlayerScoresBySeedQuery.all(seed_id, maxResults) as RawScore[];
		return result.map(ScoreRepository.decodeRawScore);
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
	
	public static decodeRawScore(raw: RawScore) {
		const raw_seed: any = {}
		const seed_keys = Object.keys(raw).filter(k => k.startsWith('seed__')) as (keyof RawScore)[];
		const clean_raw: Partial<RawScore> = raw;
		for (let key of seed_keys) {
			raw_seed[key.substring(6)] = raw[key];
			clean_raw[key] = undefined;
		}
		const player: any = {};
		const player_keys = Object.keys(raw).filter(k => k.startsWith('player__')) as (keyof RawScore)[];
		for (let key of player_keys) {
			player[key.substring(8)] = raw[key];
			clean_raw[key] = undefined;
		}

		return {
			...clean_raw,
			url_type: URL_TYPES[raw.url_type],
			submitted_at: new Date(raw.submitted_at * 1000),
			player: player,
			seed: SeedRepository.decodeRawSeed(raw_seed),
		} as Score;
	}
}