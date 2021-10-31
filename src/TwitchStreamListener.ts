import { ApiClient, HelixStream, HelixUser } from '@twurple/api';
import { DirectConnectionAdapter, EventSubChannelUpdateEvent, EventSubListener, EventSubSubscription } from '@twurple/eventsub';
import { NgrokAdapter } from '@twurple/eventsub-ngrok';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import BingoBot from './BingoBot';

/**
 * A listener for bingo twitch streams
 */
export default class TwitchStreamListener {
	private readonly eventEmitter = new EventEmitter();
	private readonly client: ApiClient;
	private readonly listener: EventSubListener;
	private trustedBroadcasters = new Map<string, { streamOnlineSub: EventSubSubscription, streamOfflineSub: EventSubSubscription }>();
	private liveTrustedBroadcasters = new Map<string, EventSubSubscription>();

	/** 
	 * Constructs a TwitchStreamListener
	 * @param clientId The twitch client id
	 * @param clientSecret The twitch client secret
	 * @param eventSubSecret The randomly generated eventsubsecret (see
	 * https://dev.twitch.tv/docs/eventsub#secret)
	 * @param trustedBroadcasters A list of broadcasters you trust
	*/
	constructor(client: ApiClient) {
		this.client = client;
		const adapter = !BingoBot.config.ssl ? new NgrokAdapter() : new DirectConnectionAdapter({
			hostName: BingoBot.config.ssl.hostName,
			sslCert: {
				cert: BingoBot.config.ssl.certificate,
				key: BingoBot.config.ssl.key
			}
		});
		this.listener = new EventSubListener({
			apiClient: this.client,
			adapter: adapter,
			secret: BingoBot.config.twitch.eventSubSecret
		});
	}

	/**
	 * Starts the listner.
	 * All listners should be registered when calling this, as events might be
	 * triggered from when this method is called first.
	 */
	public async start(): Promise<void> {
		let broadcasters: Array<string>;
		try {
			broadcasters = JSON.parse((await readFile('./data/broadcasters.json')).toString('utf8'));
		} catch {
			broadcasters = [];
		}

		broadcasters.forEach(async userId => {
			await this.addBroadcasterInternal(userId);
		});

		const users = await this.client.users.getUsersByIds(broadcasters);
		users.forEach(async user => {
			const stream = await user.getStream();
			if(stream) {
				this.handleStream(stream);
			} else {
				this.handleStreamOffline(user.id);
			}
		});
		await this.listener.listen();

		await this.fetchUntrustedStreams();
	}

	public async addBroadcaster(user: HelixUser): Promise<boolean> {
		if(this.trustedBroadcasters.has(user.id)) {
			return false;
		}
		
		await this.addBroadcasterInternal(user.id);
		await this.saveBroadcasters();

		const stream = await user.getStream();
		if(stream) {
			await this.handleStream(stream);
		}

		return true;
	}

	public async removeBroadcaster(userId: string): Promise<boolean> {
		const eventSubs = this.trustedBroadcasters.get(userId);
		await eventSubs?.streamOnlineSub.stop();
		await eventSubs?.streamOfflineSub.stop();

		const success = this.trustedBroadcasters.delete(userId);
		await this.saveBroadcasters();
		await this.handleStreamOffline(userId);
		return success;
	}

	public get broadcasters(): string[] {
		return Array.from(this.trustedBroadcasters.keys());
	}

	private async addBroadcasterInternal(userId: string): Promise<void> {
		const onlineSub = await this.listener.subscribeToStreamOnlineEvents(userId, async event => {
			BingoBot.logger.info(`Received stream online event for ${event.broadcasterDisplayName} (${event.broadcasterId}).`);
			await this.handleStream(await event.getStream())
		});

		const offlineSub = await this.listener.subscribeToStreamOfflineEvents(userId, async event => {
			BingoBot.logger.info(`Received stream offline event for ${event.broadcasterDisplayName} (${event.broadcasterId}).`);
			await this.handleStreamOffline(event.broadcasterId);
		});
		this.trustedBroadcasters.set(userId, {streamOnlineSub: onlineSub, streamOfflineSub: offlineSub});
	}

	/**
	 * The given event handler is called with the stream as argument whenever
	 * a trusted broadcaster goes live.
	 * @param handler The function being called when a trusted broadcaster goes live
	 */
	public onTrustedBingoBroadcastWentLive(handler : (stream: HelixStream) => void) {
		this.eventEmitter.on('trustedStream', handler)
	}
	
	/**
	 * The given event handler is called with the stream as argument whenever
	 * an untrusted broadcaster goes live.
	 * 
	 * Since the twitch api does not provied a native listner, all streams are
	 * fetched every 10 minutes. This generally means that untrusted broadcasters
	 * will have a higher delay.
	 * 
	 * @param handler The function being called when an untrusted broadcaster goes live
	 */
	public onUntrustedBingoBroadcastWentLive(handler: (stream: HelixStream) => void) {
		this.eventEmitter.on('untrustedStream', handler)
	}
	
	/**
	 * This event is called whenever a trusted bingo broadcaster goes offline.
	 * 
	 * @param handler The function being called when an untrusted broadcaster goes live
	 */
	public onBroadcasterWentOffline(handler : (broadcasterId: string) => void) {
		this.eventEmitter.on('broadcasterOffline', handler)
	}

	private async fetchUntrustedStreams(): Promise<void> {
		try {
			let streams = await this.client.streams.getStreams({game: '27471', type: 'live', limit: 100});
			while(streams.data.length > 0) {

				streams.data.forEach(async stream => await this.handleStream(stream));
				streams = await this.client.streams.getStreams({game: '27471', type: 'live', after: streams.cursor, limit: 100});
			}

			// fetch every 5 hrs. This is meant to just help me update the list of trusted
			// broadcasters, doesn't have to catch every stream, and doesn't have to be real
			// time. Let's not make Twitch too suspicious of us.
			setTimeout(() => this.fetchUntrustedStreams(), 18_000_000);
		}
		catch (err) {
			BingoBot.logger.error(err);
			setTimeout(() => this.fetchUntrustedStreams(), 18_000_000);
		}
	}

	private async handleStream(stream: HelixStream): Promise<void> {
		try {
			BingoBot.logger.debug(`Handling stream "${stream.title}" by ${stream.userDisplayName}.`);
			if(!this.liveTrustedBroadcasters.has(stream.userId) && stream.title.match(/bingo/i) && stream.gameId == '27471') {
				if(this.trustedBroadcasters.has(stream.userId)) {
					this.liveTrustedBroadcasters.set(
						stream.userId,
						await this.listener.subscribeToChannelUpdateEvents(stream.userId, async event => await this.handleStreamUpdate(event))
					);
					this.eventEmitter.emit('trustedStream', stream);
				} else {
					this.eventEmitter.emit('untrustedStream', stream)
				}
			}
		} catch (err) {
			BingoBot.logger.error(err);
		}
	}

	private async handleStreamOffline(broadcasterId: string): Promise<void> {
		try {
			this.eventEmitter.emit('broadcasterOffline', broadcasterId);
			if(this.liveTrustedBroadcasters.has(broadcasterId)) {
				await this.liveTrustedBroadcasters.get(broadcasterId)!.stop();
				this.liveTrustedBroadcasters.delete(broadcasterId);
			}
		} catch (err) {
			BingoBot.logger.error(err);
		}
	}

	private async handleStreamUpdate(event: EventSubChannelUpdateEvent): Promise<void> {
		try {
			BingoBot.logger.info(`Received channel update event for ${event.broadcasterDisplayName}`);
			if(event.streamTitle.match(/bingo/i) && event.categoryId === '27471') {
				const stream = (await this.client.streams.getStreams({userId: event.broadcasterId})).data[0];
				this.eventEmitter.emit('trustedStream', stream);
			} else {
				this.eventEmitter.emit('broadcasterOffline', event.broadcasterId);
			}
		} catch (err) {
			BingoBot.logger.error(err);
		}
	}

	public async destroy(): Promise<void> {
		await this.listener.unlisten()
	}

	private async saveBroadcasters(): Promise<void> {
		if(!existsSync('./data/')) {
			await mkdir('./data/');
		}
		await writeFile('./data/broadcasters.json', JSON.stringify(Array.from(this.trustedBroadcasters.keys())), {flag: 'w', encoding: 'utf8'});
	}
}