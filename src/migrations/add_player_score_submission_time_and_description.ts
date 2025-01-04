import { DatabaseSync } from "node:sqlite";

export default function migrate_add_player_score_submission_time_and_description(db: DatabaseSync) {

	if (db.prepare(`SELECT 1 FROM migrations WHERE id = 2`).all().length === 0) {
		db.exec(`
			BEGIN TRANSACTION;

			CREATE TABLE player_scores_tmp(
				seed_id INTEGER NOT NULL REFERENCES seeds(id) ON DELETE CASCADE ON UPDATE CASCADE,
				player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE ON UPDATE CASCADE,
				points INTEGER,
				time_in_millis INTEGER,
				url_type INTEGER CHECK (url_type ISNULL OR url_type BETWEEN 0 AND 1),
				url TEXT,
				description TEXT,
				submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),

				PRIMARY KEY (seed_id, player_id)
			);

			INSERT INTO player_scores_tmp(seed_id, player_id, points, time_in_millis, url_type, url)
			SELECT * FROM player_scores;

			DROP TABLE player_scores;
			ALTER TABLE player_scores_tmp RENAME TO player_scores;

			INSERT INTO migrations(id, name) VALUES (2, 'add_player_score_submission_time_and_description');

			COMMIT TRANSACTION;
		`)
	}
}