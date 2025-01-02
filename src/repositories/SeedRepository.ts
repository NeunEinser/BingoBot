import { DatabaseSync, StatementSync, SupportedValueType } from "node:sqlite";
import VersionRepository from "./VersionRepository";
import SemVer from "../util/SemVer";
import WeekRepository, { Week } from "./WeekRepository";

const DEFAULT_QUERY = `SELECT seed.id,
	seed.seed,
	seed.game_type,
	seed.game_type_specific,
	seed.description,
	week.id week_id,
	week.week week_week,
	version.major || '.' || version.minor || '.' || version.patch week_version,
	mc_version.major || '.' || mc_version.minor || '.' || mc_version.patch week_mc_version,
	max_version.major || '.' || max_version.minor || '.' || max_version.patch week_max_version,
	max_mc_version.major || '.' || max_mc_version.minor || '.' || max_mc_version.patch week_max_mc_version,
	week.published_on_unix_millis week_published_on_unix_millis,
	week.discord_message_id week_discord_message_id,
	week.description week_desription
FROM seeds seed
	JOIN weeks week ON seed.week_id = week.id
	JOIN versions version ON week.version_id = version.id
	JOIN minecraft_versions mc_version ON week.minecraft_version_id = mc_version.id
	LEFT JOIN versions max_version ON week.max_version_id = max_version.id
	LEFT JOIN minecraft_versions max_mc_version ON week.max_minecraft_version_id = max_mc_version.id`

interface RawSeed {
	id: number;
	seed: number;
	game_type: number,
	game_type_specific: SupportedValueType,
	description: string | null;
	week_id: number,
	week_week: number;
	week_version: string;
	week_max_version: string | null;
	week_mc_version: string;
	week_max_mc_version: string | null;
	week_published_on_unix_millis?: number | null;
	week_discord_message_id: string | null;
	week_description: string | null;
}

export interface Seed {
	id: number;
	seed: number;
	game_type: number,
	game_type_specific: SupportedValueType,
	description: string | null;
	week: Week;
}

export default class SeedRepository {
	private readonly getSeedQuery: StatementSync;
	private readonly getSeedsByWeekIdQuery: StatementSync;
	private readonly getFilteredSeedsQuery: StatementSync;
	private readonly deleteSeedQuery: StatementSync;
	private readonly createSeedQuery: StatementSync;
	constructor(
		db: DatabaseSync,
	) {
		this.getSeedQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE seed.id = ?
		`);
		this.getSeedsByWeekIdQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE week.id = ?
			ORDER BY game_type, seed
		`);
		this.getFilteredSeedsQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE seed.seed LIKE @filter || '%' OR seed.id LIKE @filter || '%'
			ORDER BY
				CASE WHEN week.published_on_unix_millis ISNULL THEN 0 ELSE 1 END,
				week.published_on_unix_millis DESC
			LIMIT @limit
		`);
		this.deleteSeedQuery = db.prepare('DELETE FROM seeds WHERE id = ?');
		this.createSeedQuery = db.prepare(`
			INSERT INTO seeds(week_id, seed, game_type, game_type_specific, description)
			VALUES (?, ?, ?, ?, ?)
		`);
	}

	public getSeed(id: number) {
		const result = this.getSeedQuery.all(id);
		if (result.length === 0) {
			return null;
		}
		return SeedRepository.decodeRawSeed(result[0] as RawSeed);
	}

	public getSeedsByWeekId(week_id: number) {
		return (this.getSeedsByWeekIdQuery.all(week_id) as RawSeed[])
			.map(SeedRepository.decodeRawSeed);
	}

	public getFilteredSeeds(seedStart: string, limit: number) {
		return (this.getFilteredSeedsQuery.all({ filter: seedStart, limit: limit}) as RawSeed[])
			.map(SeedRepository.decodeRawSeed);
	}

	public createSeed(week_id: number, seed: number, game_type: number, game_type_specific?: SupportedValueType, description?: string | null) {
		this.createSeedQuery.run(week_id, seed, game_type, game_type_specific ?? null, description ?? null);
	}

	public deleteSeed(id: number) {
		this.deleteSeedQuery.run(id);
	}

	private static decodeRawSeed(raw: RawSeed) {
		const raw_week: any = {}
		const week_keys = Object.keys(raw).filter(k => k.startsWith('week_')) as (keyof RawSeed)[]
		const clean_raw: Partial<RawSeed> = raw;
		for (let key of week_keys) {
			raw_week[key.substring(5)] = raw[key];
			clean_raw[key] = undefined;
		}

		return {
			...clean_raw,
			week: WeekRepository.decodeRawWeek(raw_week),
		} as Seed;
	}
}