import { DatabaseSync, StatementSync } from "node:sqlite";

export interface Player {
	id: number;
	in_game_name: string;
	discord_id: string;
}

export default class PlayerRepository {
	
	private readonly getPlayerQuery: StatementSync;
	private readonly getPlayerByDiscordIdQuery: StatementSync;
	private readonly createPlayerQuery: StatementSync;
	private readonly setIgnQuery: StatementSync;
	constructor(
		db: DatabaseSync,
	) {
		this.getPlayerQuery = db.prepare(`
			SELECT id, in_game_name, discord_id
			FROM players
			WHERE id = ?
			LIMIT 1
		`);
		this.getPlayerByDiscordIdQuery = db.prepare(`
			SELECT id, in_game_name, discord_id
			FROM players
			WHERE discord_id = ?
			LIMIT 1
		`);
		this.createPlayerQuery = db.prepare(`
			INSERT INTO players(discord_id, in_game_name) VALUES (?, ?);
		`);
		this.setIgnQuery = db.prepare(`
			UPDATE players
			SET in_game_name = ?
			WHERE discord_id = ?
		`);
	}

	public getPlayer(id: number) {
		const result = this.getPlayerQuery.all(id) as Player[];
		if (result.length === 0) {
			return null;
		}
		return result[0];
	}

	public getPlayerByDiscordId(discord_id: string) {
		const result = this.getPlayerByDiscordIdQuery.all(discord_id) as Player[];
		if (result.length === 0) {
			return null;
		}
		return result[0];
	}

	public createPlayer(discord_id: string, in_game_name?: string | null) {
		this.createPlayerQuery.run(discord_id, in_game_name ?? null);
	}

	public setIgn(discord_id: string, in_game_name: string) {
		this.setIgnQuery.run(in_game_name, discord_id);
	}
}