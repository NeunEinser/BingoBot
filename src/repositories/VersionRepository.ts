import { DatabaseSync, StatementSync } from "node:sqlite";
import SemVer from "../util/SemVer";

export default class VersionRepository {
	private readonly getVersionIdBySemVerQuery: StatementSync;
	private readonly insertVersionQuery: StatementSync;
	private readonly getFilteredVersionsQuery: StatementSync;
	private readonly getMinecraftVersionIdBySemVerQuery: StatementSync;
	private readonly getFilteredMinecraftVersionsQuery: StatementSync;
	private readonly insertMinecraftVersionQuery: StatementSync;
	private readonly getLastInsertedRowIdQuery: StatementSync;

	constructor(private readonly db: DatabaseSync) {
		this.getVersionIdBySemVerQuery = db.prepare(`
			SELECT id
			FROM versions version
			WHERE major = ? AND minor = ? AND patch = ?;
		`)
		this.getFilteredVersionsQuery = db.prepare(`
			SELECT major, minor, patch
			FROM versions version
			WHERE (major LIKE @first_part || '%' AND minor LIKE @second_part || '%' AND patch LIKE @third_part || '%')
				OR (@third_part = '' AND minor LIKE @first_part || '%' AND patch LIKE @second_part || '%')
				OR (@second_part = '' AND @third_part = '' AND patch LIKE @first_part || '%')
			ORDER BY major DESC, minor DESC, patch DESC
			LIMIT @limit;
		`)
		this.insertVersionQuery = db.prepare(`
			INSERT INTO versions(major, minor, patch)
			VALUES (?, ?, ?);
		`)
		this.getMinecraftVersionIdBySemVerQuery = db.prepare(`
			SELECT id
			FROM minecraft_versions version
			WHERE major = ? AND minor = ? AND patch = ?;
		`)
		this.getFilteredMinecraftVersionsQuery = db.prepare(`
			SELECT major, minor, patch
			FROM minecraft_versions version
			WHERE (major LIKE @first_part || '%' AND minor LIKE @second_part || '%' AND patch LIKE @third_part || '%')
				OR (@third_part = '' AND minor LIKE @first_part || '%' AND patch LIKE @second_part || '%')
				OR (@second_part = '' AND @third_part = '' AND patch LIKE @first_part || '%')
			ORDER BY major DESC, minor DESC, patch DESC
			LIMIT @limit;
		`)
		this.insertMinecraftVersionQuery = db.prepare(`
			INSERT INTO minecraft_versions(major, minor, patch)
			VALUES (?, ?, ?);
		`)
		this.getLastInsertedRowIdQuery = db.prepare('SELECT last_insert_rowid() rowid');
	}

	public getOrCreateVersionIdBySemVer(version: SemVer) {
		const result = this.getVersionIdBySemVerQuery.all(version.major, version.minor, version.patch) as {id: number}[];
		if (result.length > 0) {
			return result[0].id
		}

		this.createVersion(version);
		return (this.getLastInsertedRowIdQuery.all() as {rowid:number}[])[0].rowid;
	}

	public getOrCreateMinecraftVersionIdBySemVer(version: SemVer) {
		const result = this.getMinecraftVersionIdBySemVerQuery.all(version.major, version.minor, version.patch) as {id: number}[];
		if (result.length > 0) {
			return result[0].id
		}

		this.createMinecraftVersion(version);
		return (this.getLastInsertedRowIdQuery.all() as {rowid:number}[])[0].rowid;
	}

	public getFilteredVersions(firstStart: string, secondStart: string, thirdStart: string, limit: number) {
		const result = this.getFilteredVersionsQuery.all({
			first_part: firstStart,
			second_part: secondStart,
			third_part: thirdStart,
			limit
		}) as any[];
		return result.map(v => new SemVer(v.major, v.minor, v.patch));
	}

	public getFilteredMinecraftVersions(firstStart: string, secondStart: string, thirdStart: string, limit: number) {
		const result = this.getFilteredMinecraftVersionsQuery.all({
			first_part: firstStart,
			second_part: secondStart,
			third_part: thirdStart,
			limit
		}) as any[];
		return result.map(v => new SemVer(v.major, v.minor, v.patch));
	}

	public createVersion(version: SemVer) {
		this.insertVersionQuery.run(version.major, version.minor, version.patch);
	}

	public createMinecraftVersion(version: SemVer) {
		this.insertMinecraftVersionQuery.run(version.major, version.minor, version.patch);
	}
}