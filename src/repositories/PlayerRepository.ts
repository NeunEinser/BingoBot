import { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";
import { mapTo, type TypeMap } from "../util/type_utils";

export interface Player {
	id: number;
	in_game_name: string | null;
	discord_id: string;
}

const PLAYER_TYPE_MAP = Object.freeze(
	{ id: [ 'number' ], in_game_name: [ 'string', 'null' ], discord_id: [ 'string' ] } satisfies TypeMap<Player>);

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
		return PlayerRepository.mapPlayer(this.getPlayerQuery.get(id));
	}

	public getPlayerByDiscordId(discord_id: string) {
		return PlayerRepository.mapPlayer(this.getPlayerByDiscordIdQuery.get(discord_id));
	}

	public createPlayer(discord_id: string, in_game_name?: string | null) {
		this.createPlayerQuery.run(discord_id, in_game_name ?? null);
	}

	public setIgn(discord_id: string, in_game_name: string) {
		this.setIgnQuery.run(in_game_name, discord_id);
	}

	public static mapPlayer(raw: Record<string, SQLOutputValue> | undefined | null, prefix: string = '') {
		return mapTo<Player>(raw, PLAYER_TYPE_MAP, prefix) as Player | null
	}
}