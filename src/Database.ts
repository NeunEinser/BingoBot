import { DatabaseSync } from "node:sqlite";
import WeekRepository from "./repositories/WeekRepository";
import VersionRepository from "./repositories/VersionRepository";
import SeedRepository from "./repositories/SeedRepository";

export default class Database {
	public readonly versions: VersionRepository;
	public readonly weeks: WeekRepository;
	public readonly seeds: SeedRepository;

	public constructor(private readonly db: DatabaseSync) {
		db.exec(`
			PRAGMA foreign_keys = true;

			CREATE TABLE IF NOT EXISTS versions(
				id INTEGER PRIMARY KEY,
				major INTEGER NOT NULL CHECK (major >= 0),
				minor INTEGER NOT NULL CHECK (minor >= 0),
				patch INTEGER NOT NULL CHECK (patch >= 0),

				CONSTRAINT AK__versions__major__minor__patch UNIQUE (major, minor, patch)
			);

			INSERT OR IGNORE INTO versions (major, minor, patch)
			VALUES
				(5, 0, 0),
				(5, 0, 1),
				(5, 1, 0),
				(5, 1, 1),
				(5, 1, 2),
				(5, 1, 3),
				(5, 2, 0);

			CREATE TABLE IF NOT EXISTS minecraft_versions(
				id INTEGER PRIMARY KEY,
				major INTEGER NOT NULL CHECK (major >= 0),
				minor INTEGER NOT NULL CHECK (minor >= 0),
				patch INTEGER NOT NULL CHECK (patch >= 0),

				CONSTRAINT AK__minecraft_versions__major__minor__patch UNIQUE (major, minor, patch)
			);

			INSERT OR IGNORE INTO minecraft_versions (major, minor, patch)
			VALUES
				(1, 16, 5),
				(1, 20, 0),
				(1, 20, 1),
				(1, 20, 2),
				(1, 20, 3),
				(1, 20, 4),
				(1, 20, 5),
				(1, 20, 6),
				(1, 21, 0),
				(1, 21, 1),
				(1, 21, 2),
				(1, 21, 3),
				(1, 21, 4);

			CREATE TABLE IF NOT EXISTS weeks(
				id INTEGER PRIMARY KEY,
				week INTEGER NOT NULL,
				version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
				minecraft_version_id INTEGER NOT NULL REFERENCES minecraft_versions ON DELETE RESTRICT ON UPDATE CASCADE,
				max_version_id INTEGER REFERENCES versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
				max_minecraft_version_id INTEGER REFERENCES minecraft_versions ON DELETE RESTRICT ON UPDATE CASCADE,
				description TEXT,
				published_on_unix_millis INTEGER,
				discord_message_id TEXT,

				CONSTRAINT AK__weeks__week__version_id UNIQUE (week, version_id)
			);

			CREATE TABLE IF NOT EXISTS seeds(
				id INTEGER PRIMARY KEY,
				week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE ON UPDATE CASCADE,
				seed INTEGER NOT NULL,
				game_type INTEGER NOT NULL CHECK (game_type BETWEEN 0 AND 7),
				game_type_specific,
				description TEXT,

				CONSTRAINT AK__seeds__week_id__seed UNIQUE (week_id, seed)
			);
			
			CREATE TABLE IF NOT EXISTS players(
				id INTEGER PRIMARY KEY,
				in_game_name TEXT NOT NULL,
				discord_id TEXT
			);

			CREATE TABLE IF NOT EXISTS player_scores(
				seed_id INTEGER NOT NULL REFERENCES seeds(id) ON DELETE CASCADE ON UPDATE CASCADE,
				player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE ON UPDATE CASCADE,
				time_in_millis INTEGER NOT NULL,
				url_type INTEGER NOT NULL CHECK (url_type BETWEEN 0 AND 1),
				url TEXT
			);
		`)

		this.versions = new VersionRepository(db);
		this.weeks = new WeekRepository(db, this.versions);
		this.seeds = new SeedRepository(db);
	}

	public close() {
		try {
			this.db.close();
		} catch {}
	}
}