import { DatabaseSync, StatementSync } from "node:sqlite";
import WeekRepository from "./repositories/WeekRepository";
import VersionRepository from "./repositories/VersionRepository";
import SeedRepository from "./repositories/SeedRepository";
import ScoreRepository from "./repositories/ScoreRepository";
import PlayerRepository from "./repositories/PlayerRepository";
import migrate_initial from "./migrations/initial";
import migrate_add_player_score_submission_time_and_description from "./migrations/add_player_score_submission_time_and_description";

export default class Database {
	public readonly versions: VersionRepository;
	public readonly weeks: WeekRepository;
	public readonly seeds: SeedRepository;
	public readonly scores: ScoreRepository;
	public readonly players: PlayerRepository;

	private readonly getLastInsertedRowIdQuery: StatementSync;

	public constructor(private readonly db: DatabaseSync) {
		db.exec('PRAGMA foreign_keys = true;');
		migrate_initial(db);
		migrate_add_player_score_submission_time_and_description(db);

		this.versions = new VersionRepository(db);
		this.weeks = new WeekRepository(db, this.versions);
		this.seeds = new SeedRepository(db);
		this.scores = new ScoreRepository(db);
		this.players = new PlayerRepository(db);

		this.getLastInsertedRowIdQuery = db.prepare('SELECT last_insert_rowid() rowid');
	}

	public getLastInsertRowId() {
		const result = this.getLastInsertedRowIdQuery.all() as { rowid: number }[];
		if (result.length === 0) {
			return 0;
		}
		return result[0].rowid;
	}

	public executeInTransaction<T>(action: () => T): T
		executeInTransaction<T>(action: () => Promise<T>): Promise<T> {
		this.db.exec('BEGIN TRANSACTION');
		try {
			const result = action();
			if (result instanceof Promise) {
				return new Promise((resolve, reject) => {
					result.then(val => {
						this.db.exec('COMMIT TRANSACTION');
						resolve(val);
					}).catch(err => {
						this.db.exec('ROLLBACK TRANSACTION');
						reject(err);
					});
				});
			}
			this.db.exec('COMMIT TRANSACTION');
			return result;
		} catch (e) {
			try {
				this.db.exec('ROLLBACK TRANSACTION');
			} catch {}
			throw e;
		}
	}

	public close() {
		try {
			this.db.close();
		} catch {}
	}
}