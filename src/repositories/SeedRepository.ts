import { DatabaseSync, StatementSync } from "node:sqlite";
import WeekRepository, { Week } from "./WeekRepository";
import { createMapper, filterMap, TypeMap } from "../util/type_utils";

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
	week.description week__description
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

export interface Seed {
	id: number;
	seed: number;
	practiced: boolean;
	game_type: GameType,
	game_type_specific: string | number | bigint | null;
	discord_message_id: string | null;
	description: string | null;
	week: Week;
}

export const gameTypeFromInt = (v: any) => (typeof v === 'number') ? (GAME_TYPES[v] ?? null) : null;

const SEED_TYPE_MAP = Object.freeze(
	{
		id: [ 'number' ],
		seed: [ 'number' ],
		practiced: [ 'boolean' ],
		game_type: [ gameTypeFromInt ],
		game_type_specific: [ 'string', 'number', 'bigint', 'null' ],
		discord_message_id: [ 'string', 'null' ],
		description: [ 'string', 'null' ],
		week: [ (raw, prefix) => WeekRepository.mapWeek(raw, prefix) ],
	} satisfies TypeMap<Seed>);

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
			WHERE id = ?
		`);
	}

	public getSeed(id: number) {
		return SeedRepository.mapSeed(this.getSeedQuery.get(id));
	}

	public getSeedBySeedNumberAndWeek(seed: number, week_id: number) {
		return SeedRepository.mapSeed(this.getSeedBySeedNumberAndWeekQuery.get(seed, week_id));
	}

	public getSeedsByWeekId(week_id: number) {
		return filterMap(this.getSeedsByWeekIdQuery.all(week_id), SeedRepository.mapSeed);
	}

	public getFilteredSeeds(seedFilter: string, limit: number) {
		return filterMap(this.getFilteredSeedsQuery.all({ filter: seedFilter, limit: limit}), SeedRepository.mapSeed);
	}

	public getFilteredSeedsByWeek(seedFilter: string, week_id: number, maxResults: number) {
		return filterMap(this.getFilteredSeedsByWeekQuery.all(seedFilter, week_id, maxResults), SeedRepository.mapSeed);
	}

	public createSeed(week_id: number, seed: number, game_type: GameType, practiced: boolean = false, game_type_specific?: string | number | bigint | null, description?: string | null) {
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

	public static mapSeed = createMapper<Seed>(SEED_TYPE_MAP);
}