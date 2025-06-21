import { DatabaseSync, StatementSync } from "node:sqlite";
import VersionRepository from "./VersionRepository";
import SemVer from "../util/SemVer";
import { createMapper, filterMap, TypeMap } from "../util/type_utils";

const DEFAULT_QUERY = `SELECT week.id,
	week.week,
	version.major || '.' || version.minor || '.' || version.patch version,
	mc_version.major || '.' || mc_version.minor || '.' || mc_version.patch mc_version,
	max_version.major || '.' || max_version.minor || '.' || max_version.patch max_version,
	max_mc_version.major || '.' || max_mc_version.minor || '.' || max_mc_version.patch max_mc_version,
	week.published_on_unix_millis,
	week.discord_message_id,
	week.description
FROM weeks week
	JOIN versions version ON week.version_id = version.id
	JOIN minecraft_versions mc_version ON week.minecraft_version_id = mc_version.id
	LEFT JOIN versions max_version ON week.max_version_id = max_version.id
	LEFT JOIN minecraft_versions max_mc_version ON week.max_minecraft_version_id = max_mc_version.id`

export interface Week {
	id: number;
	week: number;
	version: SemVer;
	max_version: SemVer | null;
	mc_version: SemVer;
	max_mc_version: SemVer | null;
	published_on: Date | null;
	discord_message_id: string | null;
	description: string | null;
}

const WEEK_TYPE_MAP = Object.freeze(
	{
		id: [ 'number' ],
		week: [ 'number' ],
		version: [ 'SemVer' ],
		max_version: [ 'SemVer', 'null' ],
		mc_version: [ 'SemVer' ],
		max_mc_version: [ 'SemVer', 'null' ],
		published_on: [ 'Date', 'null' ],
		discord_message_id: [ 'string', 'null' ],
		description: [ 'string', 'null' ],
	} satisfies TypeMap<Week>);

export default class WeekRepository {
	private readonly getWeekQuery: StatementSync;
	private readonly getCurrentWeekQuery: StatementSync;
	private readonly getNextWeekNumberQuery: StatementSync;
	private readonly getWeekByWeekNumberQuery: StatementSync;
	private readonly getUnpublishedFilteredWeeksQuery: StatementSync;
	private readonly getFilteredWeeksQuery: StatementSync;
	private readonly createWeekQuery: StatementSync;
	private readonly publishWeekQuery: StatementSync;
	private readonly deleteWeekQuery: StatementSync;
	constructor(
		db: DatabaseSync,
		private readonly versions: VersionRepository
	) {
		this.getWeekQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE week.id = ?
			ORDER BY
				CASE WHEN published_on_unix_millis IS NULL THEN 0 ELSE 1 END,
				published_on_unix_millis DESC
		`);
		this.getCurrentWeekQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE published_on_unix_millis NOT NULL
				AND discord_message_id NOT NULL
			ORDER BY published_on_unix_millis DESC
			LIMIT 1
		`);
		this.getNextWeekNumberQuery = db.prepare(`SELECT week + 1 value FROM weeks
			ORDER BY
				CASE WHEN published_on_unix_millis IS NULL THEN 0 ELSE 1 END,
				published_on_unix_millis DESC,
				week
			LIMIT 1
		`);
		this.getWeekByWeekNumberQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE week.week = ?
			ORDER BY
				CASE WHEN published_on_unix_millis IS NULL THEN 0 ELSE 1 END,
				published_on_unix_millis DESC
			LIMIT 1
		`);
		this.getUnpublishedFilteredWeeksQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE published_on_unix_millis ISNULL
				AND discord_message_id ISNULL
				AND  week.week LIKE ? || '%'
			ORDER BY published_on_unix_millis DESC
			LIMIT ?
		`);
		this.getFilteredWeeksQuery = db.prepare(`${DEFAULT_QUERY}
			WHERE week.week LIKE '%' || ? || '%'
			ORDER BY
				CASE WHEN published_on_unix_millis IS NULL THEN 0 ELSE 1 END,
				published_on_unix_millis DESC
			LIMIT ?
		`);
		this.createWeekQuery = db.prepare(`
			INSERT INTO weeks(week, version_id, minecraft_version_id, max_version_id, max_minecraft_version_id, description)
			VALUES (?, ?, ?, ?, ?, ?)
		`);
		this.publishWeekQuery = db.prepare(`
			UPDATE weeks SET
				published_on_unix_millis = ?,
				discord_message_id = ?
			WHERE id = ? AND published_on_unix_millis ISNULL AND discord_message_id ISNULL
		`);
		this.deleteWeekQuery = db.prepare(`
			DELETE FROM weeks WHERE id = ?;
		`);
	}

	public getWeek(week_id: number) {
		return WeekRepository.mapWeek(this.getWeekQuery.get(week_id));
	}

	public getCurrentWeek() {
		return WeekRepository.mapWeek(this.getCurrentWeekQuery.get());
	}

	public getNextWeekNumber() {
		const result = this.getNextWeekNumberQuery.get();
		if (result && typeof result["value"] == "number") {
			return result["value"]
		}

		return 1;
	}

	public getWeekByWeekNumber(week: number) {
		return WeekRepository.mapWeek(this.getWeekByWeekNumberQuery.get(week));
	}

	public getUnpublishedFilteredWeeks(weekFilter: string, maxResults: number) {
		return filterMap(this.getUnpublishedFilteredWeeksQuery.all(weekFilter, maxResults), WeekRepository.mapWeek)
	}

	public getFilteredWeeks(weekStart: string, maxResults: number) {
		return filterMap(this.getFilteredWeeksQuery.all(weekStart, maxResults), WeekRepository.mapWeek)
	}


	public createWeek(weekNumber: number, version: SemVer, mc_version: SemVer, max_version?: SemVer | null, max_mc_version?: SemVer | null, description?: string | null) {
		const version_id = this.versions.getOrCreateVersionIdBySemVer(version);
		const mc_version_id = this.versions.getOrCreateMinecraftVersionIdBySemVer(mc_version);
		const max_version_id = max_version ? this.versions.getOrCreateVersionIdBySemVer(max_version) : null;
		const max_mc_version_id = max_mc_version ? this.versions.getOrCreateMinecraftVersionIdBySemVer(max_mc_version) : null;
		
		this.createWeekQuery.run(weekNumber, version_id, mc_version_id, max_version_id, max_mc_version_id, description ?? null);
	}

	public publishWeek(week_id: number, discord_message_id: string) {
		this.publishWeekQuery.run(Date.now(), discord_message_id, week_id);
	}

	public deleteWeek(week_id: number) {
		this.deleteWeekQuery.run(week_id);
	}

	public static mapWeek = createMapper<Week>(WEEK_TYPE_MAP);
}