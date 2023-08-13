import { ApiClient, HelixStream, HelixUser } from '@twurple/api';
import { rawDataSymbol } from '@twurple/common';
import { EventSubChannelUpdateEvent, EventSubSubscription } from '@twurple/eventsub-base';
import { DirectConnectionAdapter, EventSubHttpListener } from '@twurple/eventsub-http';
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
	private readonly listener: EventSubHttpListener;
	private isListening = false;
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
		this.listener = new EventSubHttpListener({
			apiClient: this.client,
			adapter: adapter,
			secret: BingoBot.config.twitch.eventSubSecret,
			strictHostCheck: true
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

		await this.client.eventSub.deleteAllSubscriptions();
		broadcasters.forEach(async userId => {
			this.addBroadcasterInternal(userId);
		});

		const liveBroadcasters: string[] = []
		// Twitch API only accepts a maximum of 100 user IDs
		for (let i = 0; i < broadcasters.length; i+=100) {
			const streams = await this.client.streams.getStreams({userId: broadcasters.slice(i, i + 100), limit: 100});

			streams.data.forEach(s => {
				liveBroadcasters.push(s.userId);
				this.handleStream(s);
			});
		}

		broadcasters.filter(b => !liveBroadcasters.includes(b)).forEach(b => this.handleStreamOffline(b));
		this.listener.start();
		this.isListening = true;

		await this.fetchUntrustedStreams();
	}

	public async addBroadcaster(user: HelixUser): Promise<boolean> {
		if(this.trustedBroadcasters.has(user.id)) {
			return false;
		}
		
		this.addBroadcasterInternal(user.id);
		await this.saveBroadcasters();

		const stream = await user.getStream();
		if(stream) {
			this.handleStream(stream);
		}

		return true;
	}

	public async removeBroadcaster(userId: string): Promise<boolean> {
		const eventSubs = this.trustedBroadcasters.get(userId);
		eventSubs?.streamOnlineSub.stop();
		eventSubs?.streamOfflineSub.stop();

		const success = this.trustedBroadcasters.delete(userId);
		await this.saveBroadcasters();
		this.handleStreamOffline(userId);
		return success;
	}

	public get broadcasters(): string[] {
		return Array.from(this.trustedBroadcasters.keys());
	}

	private addBroadcasterInternal(userId: string) {
		const onlineSub = this.listener.onStreamOnline(userId, async event => {
			const stream = await event.getStream();
			if (stream === null) {
				BingoBot.logger.error(`Received stream online event for ${event.broadcasterDisplayName} (${event.broadcasterId}), but could not fetch stream data.`);
				return;
			}
			BingoBot.logger.info(`Received stream online event for ${event.broadcasterDisplayName} (${event.broadcasterId}): "${stream.title}" (playing ${stream.gameName}/${stream.gameId}).`);
			this.handleStream(stream);
		});

		const offlineSub = this.listener.onStreamOffline(userId, async event => {
			BingoBot.logger.info(`Received stream offline event for ${event.broadcasterDisplayName} (${event.broadcasterId}).`);
			this.handleStreamOffline(event.broadcasterId);
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
			let streams = await this.client.streams.getStreams({game: '27471', type: 'live', language: 'en', limit: 100});
			while(streams.data.length > 0) {

				streams.data.forEach(async stream => this.handleStream(stream));
				streams = await this.client.streams.getStreams({game: '27471', type: 'live', language: 'en', after: streams.cursor, limit: 100});
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

	private handleStream(stream: HelixStream) {
		try {
			BingoBot.logger.debug(`Handling stream "${stream.title}" by ${stream.userDisplayName}.`);
			if(!this.liveTrustedBroadcasters.has(stream.userId)) {
				BingoBot.logger.debug(`${stream.userDisplayName} not known to be live.`);

				if(this.trustedBroadcasters.has(stream.userId)) {
					this.liveTrustedBroadcasters.set(
						stream.userId,
						this.listener.onChannelUpdate(stream.userId, async (event) => await this.handleStreamUpdate(event))
					);
				}
				if(stream.title.match(/(?:bingo|fetchr)/i) && stream.gameId == '27471') {
					BingoBot.logger.info(`${stream.userDisplayName} is live playing Bingo!`);
					if(this.trustedBroadcasters.has(stream.userId)) {
						this.eventEmitter.emit('trustedStream', stream);
					} else {
						this.eventEmitter.emit('untrustedStream', stream)
					}
				}
			}
		} catch (err) {
			BingoBot.logger.error(err);
		}
	}

	private handleStreamOffline(broadcasterId: string) {
		try {
			this.eventEmitter.emit('broadcasterOffline', broadcasterId);
			if(this.liveTrustedBroadcasters.has(broadcasterId)) {
				this.liveTrustedBroadcasters.get(broadcasterId)!.stop();
				this.liveTrustedBroadcasters.delete(broadcasterId);
			}
		} catch (err) {
			BingoBot.logger.error(err);
		}
	}

	private async handleStreamUpdate(event: EventSubChannelUpdateEvent): Promise<void> {
		try {
			BingoBot.logger.info(`Received channel update event for ${event.broadcasterDisplayName} (${event.broadcasterId}): "${event.streamTitle}" (playing ${event.categoryName}/${event.categoryId}).`);
			if(event.streamTitle.match(/(?:bingo|fetchr)/i) && event.categoryId === '27471') {
				const stream = (await this.client.streams.getStreams({userId: event.broadcasterId})).data[0];
				stream[rawDataSymbol].title = event.streamTitle;
				this.eventEmitter.emit('trustedStream', stream);
			} else {
				this.eventEmitter.emit('broadcasterOffline', event.broadcasterId);
			}
		} catch (err) {
			BingoBot.logger.error(err);
		}
	}

	public async destroy(): Promise<void> {
		if(this.isListening) {
			await this.client.eventSub.deleteAllSubscriptions();
			this.listener.stop()
		}
	}

	private async saveBroadcasters(): Promise<void> {
		if(!existsSync('./data/')) {
			await mkdir('./data/');
		}
		await writeFile('./data/broadcasters.json', JSON.stringify(Array.from(this.trustedBroadcasters.keys())), {flag: 'w', encoding: 'utf8'});
	}
}