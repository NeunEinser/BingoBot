import { DatabaseSync } from "node:sqlite";

export default function migrate_initial(db: DatabaseSync) {
	if (
		db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations';`).all().length === 0
		|| db.prepare(`SELECT 1 FROM migrations WHERE id = 1;`).all().length === 0
	) {
	
		db.exec(`
			BEGIN TRANSACTION;

			CREATE TABLE IF NOT EXISTS migrations(
				id INTEGER NOT NULL PRIMARY KEY,
				name TEXT NOT NULL
			);
			
			INSERT OR IGNORE INTO migrations (id, name)
			VALUES (1, 'initial');

			CREATE TABLE IF NOT EXISTS versions(
				id INTEGER NOT NULL PRIMARY KEY,
				major INTEGER NOT NULL CHECK (major >= 0),
				minor INTEGER NOT NULL CHECK (minor >= 0),
				patch INTEGER NOT NULL CHECK (patch >= 0),

				UNIQUE (major, minor, patch)
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
				id INTEGER NOT NULL PRIMARY KEY,
				major INTEGER NOT NULL CHECK (major >= 0),
				minor INTEGER NOT NULL CHECK (minor >= 0),
				patch INTEGER NOT NULL CHECK (patch >= 0),

				UNIQUE (major, minor, patch)
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
				id INTEGER NOT NULL PRIMARY KEY,
				week INTEGER NOT NULL,
				version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
				minecraft_version_id INTEGER NOT NULL REFERENCES minecraft_versions ON DELETE RESTRICT ON UPDATE CASCADE,
				max_version_id INTEGER REFERENCES versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
				max_minecraft_version_id INTEGER REFERENCES minecraft_versions ON DELETE RESTRICT ON UPDATE CASCADE,
				description TEXT,
				published_on_unix_millis INTEGER,
				discord_message_id TEXT,

				UNIQUE (week, version_id)
			);

			CREATE TABLE IF NOT EXISTS seeds(
				id INTEGER NOT NULL PRIMARY KEY,
				week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE ON UPDATE CASCADE,
				seed INTEGER NOT NULL,
				practiced INTEGER NOT NULL DEFAULT 0 CHECK (practiced BETWEEN 0 AND 1),
				game_type INTEGER NOT NULL CHECK (game_type BETWEEN 0 AND 6),
				game_type_specific,
				description TEXT,
				discord_message_id TEXT,

				UNIQUE (week_id, seed, game_type)
			);
			
			CREATE TABLE IF NOT EXISTS players(
				id INTEGER NOT NULL PRIMARY KEY,
				in_game_name TEXT UNIQUE,
				discord_id TEXT UNIQUE
			);

			CREATE TABLE IF NOT EXISTS player_scores(
				seed_id INTEGER NOT NULL REFERENCES seeds(id) ON DELETE CASCADE ON UPDATE CASCADE,
				player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE ON UPDATE CASCADE,
				points INTEGER,
				time_in_millis INTEGER,
				url_type INTEGER CHECK (url_type ISNULL OR url_type BETWEEN 0 AND 1),
				url TEXT,

				PRIMARY KEY (seed_id, player_id)
			);

			COMMIT TRANSACTION;
		`)
	}
}