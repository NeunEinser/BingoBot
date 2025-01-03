import { DatabaseSync, StatementSync, SupportedValueType } from "node:sqlite";
import WeekRepository, { Week } from "./WeekRepository";

const DEFAULT_QUERY = `SELECT seed.id,
	seed.seed,
	seed.practiced,
	seed.game_type,
	seed.game_type_specific,
	seed.discord_message_id,
	seed.description,
	week.id week__id,
	week.week week__week,
	version.major || '.' || version.minor || '.' || version.patch week__version,
	mc_version.major || '.' || mc_version.minor || '.' || mc_version.patch week__mc_version,
	max_version.major || '.' || max_version.minor || '.' || max_version.patch week__max_version,
	max_mc_version.major || '.' || max_mc_version.minor || '.' || max_mc_version.patch week__max_mc_version,
	week.published_on_unix_millis week__published_on_unix_millis,
	week.discord_message_id week__discord_message_id,
	week.description week__desription
FROM seeds seed
	JOIN weeks week ON seed.week_id = week.id
	JOIN versions version ON week.version_id = version.id
	JOIN minecraft_versions mc_version ON week.minecraft_version_id = mc_version.id
	LEFT JOIN versions max_version ON week.max_version_id = max_version.id
	LEFT JOIN minecraft_versions max_mc_version ON week.max_minecraft_version_id = max_mc_version.id`

export const GAME_TYPES = Object.freeze([
	'bingo',
	'blackout',
	'20_no_bingo',
	'double_bingo',
	'triple_bingo',
	'quadruple_bingo',
	'points',
] as const);

export type GameType = (typeof GAME_TYPES)[number]

export interface RawSeed {
	id: number;
	seed: number;
	practiced: number;
	game_type: number;
	game_type_specific: SupportedValueType;
	discord_message_id: string | null;
	description: string | null;
	week__id: number,
	week__week: number;
	week__version: string;
	week__max_version: string | null;
	week__mc_version: string;
	week__max_mc_version: string | null;
	week__published_on_unix_millis?: number | null;
	week__discord_message_id: string | null;
	week__description: string | null;
}

export interface Seed {
	id: number;
	seed: number;
	practiced: boolean;
	game_type: GameType,
	game_type_specific: SupportedValueType,
	discord_message_id: string | null;
	description: string | null;
	week: Week;
}

export default class SeedRepository {
	private readonly getSeedQuery: StatementSync;
	private readonly getSeedBySeedNumberAndWeekQuery: StatementSync;
	private readonly getSeedsByWeekIdQuery: StatementSync;
	private readonly getFilteredSeedsQuery: StatementSync;
	private readonly getFilteredSeedsByWeekQuery: StatementSync;
	private readonly deleteSeedQuery: StatementSync;
	private readonly createSeedQuery: StatementSync;
	private readonly publishSeedQuery: StatementSync;
	constructor(
		db: DatabaseSync,
	) {
		this.getSeedQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE seed.id = ?
		`);
		this.getSeedBySeedNumberAndWeekQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE seed.seed = ? AND week.id = ?
		`);
		this.getSeedsByWeekIdQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE week.id = ?
			ORDER BY
				practiced, 
				game_type,
				seed
		`);
		this.getFilteredSeedsQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE seed.seed LIKE '%' || @filter || '%' OR seed.id LIKE '%' || @filter || '%'
			ORDER BY
				CASE WHEN week.published_on_unix_millis ISNULL THEN 0 ELSE 1 END,
				week.published_on_unix_millis DESC
			LIMIT @limit
		`);
		this.getFilteredSeedsByWeekQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE seed.seed LIKE '%' || ? || '%' AND week.id = ?
			ORDER BY seed.seed
			LIMIT ?
		`);
		this.deleteSeedQuery = db.prepare('DELETE FROM seeds WHERE id = ?');
		this.createSeedQuery = db.prepare(`
			INSERT INTO seeds(week_id, seed, practiced, game_type, game_type_specific, description)
			VALUES (?, ?, ?, ?, ?, ?);
		`);
		this.publishSeedQuery = db.prepare(`
			UPDATE seeds
			SET discord_message_id = ?
			WHERE id = ? AND discord_message_id ISNULL
		`);
	}

	public getSeed(id: number) {
		const result = this.getSeedQuery.all(id);
		if (result.length === 0) {
			return null;
		}
		return SeedRepository.decodeRawSeed(result[0] as RawSeed);
	}

	public getSeedBySeedNumberAndWeek(seed: number, week_id: number) {
		const result = this.getSeedBySeedNumberAndWeekQuery.all(seed, week_id);
		if (result.length === 0) {
			return null;
		}
		return SeedRepository.decodeRawSeed(result[0] as RawSeed);
	}

	public getSeedsByWeekId(week_id: number) {
		return (this.getSeedsByWeekIdQuery.all(week_id) as RawSeed[])
			.map(SeedRepository.decodeRawSeed);
	}

	public getFilteredSeeds(seedFilter: string, limit: number) {
		return (this.getFilteredSeedsQuery.all({ filter: seedFilter, limit: limit}) as RawSeed[])
			.map(SeedRepository.decodeRawSeed);
	}

	public getFilteredSeedsByWeek(seedFilter: string, week_id: number, maxResults: number) {
		return (this.getFilteredSeedsByWeekQuery.all(seedFilter, week_id, maxResults) as RawSeed[])
			.map(SeedRepository.decodeRawSeed);
	}

	public createSeed(week_id: number, seed: number, game_type: GameType, practiced: boolean = false, game_type_specific?: SupportedValueType, description?: string | null) {
		this.createSeedQuery.run(
			week_id,
			seed,
			practiced ? 1 : 0,
			GAME_TYPES.indexOf(game_type),
			game_type_specific ?? null,
			description ?? null
		);
	}

	public publishSeed(seed_id: number, discord_message_id: string) {
		this.publishSeedQuery.run(discord_message_id, seed_id);
	}

	public deleteSeed(id: number) {
		this.deleteSeedQuery.run(id);
	}

	public static decodeRawSeed(raw: RawSeed) {
		const raw_week: any = {}
		const week_keys = Object.keys(raw).filter(k => k.startsWith('week__')) as (keyof RawSeed)[]
		const clean_raw: Partial<RawSeed> = raw;
		for (let key of week_keys) {
			raw_week[key.substring(6)] = raw[key];
			clean_raw[key] = undefined;
		}

		return {
			...clean_raw,
			game_type: GAME_TYPES[raw.game_type],
			practiced: raw.practiced === 1,
			week: WeekRepository.decodeRawWeek(raw_week),
		} as Seed;
	}
}