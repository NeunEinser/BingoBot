import { ApiClient, HelixStream } from '@twurple/api';
import { DirectConnectionAdapter, EventSubListener, EventSubSubscription } from '@twurple/eventsub';
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
	private knownBroadcasterIds = new Map<string, EventSubSubscription | null>();

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
		
		this.listener.listen();

		this.fetchUntrustedStreams();
	}

	public async addBroadcaster(userId: string): Promise<boolean> {
		if(this.trustedBroadcasters.has(userId)) {
			return false;
		}
		
		await this.addBroadcasterInternal(userId);
		await this.saveBroadcasters();

		return true;
	}

	public async removeBroadcaster(userId: string): Promise<boolean> {
		const eventSubs = this.trustedBroadcasters.get(userId);
		await eventSubs?.streamOnlineSub.stop();
		await eventSubs?.streamOfflineSub.stop();

		const success = this.trustedBroadcasters.delete(userId);
		await this.saveBroadcasters();
		return success;
	}

	public get broadcasters(): string[] {
		return Array.from(this.trustedBroadcasters.keys());
	}

	private async addBroadcasterInternal(userId: string): Promise<void> {
		const onlineSub = await this.listener.subscribeToStreamOnlineEvents(userId, async event => {
			BingoBot.logger.debug(`Received stream online event for ${event.broadcasterDisplayName}.`);
			await this.handleStream(await event.getStream())
		});

		const offlineSub = await this.listener.subscribeToStreamOfflineEvents(userId, async event => {
			BingoBot.logger.debug(`Received stream offline event for ${event.broadcasterDisplayName}.`);
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

				streams.data.forEach((stream) => this.handleStream(stream));
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
			if(!this.knownBroadcasterIds.has(stream.userId)) {
				if(stream.title.match(/\bbingo\b/i)) {

					this.knownBroadcasterIds.set(stream.userId, null);

					if(this.trustedBroadcasters.has(stream.userId)) {
						this.eventEmitter.emit('trustedStream', stream);
					} else {
						this.eventEmitter.emit('untrustedStream', stream)
					}
				} else if (this.trustedBroadcasters.has(stream.userId)) {
					this.knownBroadcasterIds.set(stream.userId, await this.listener.subscribeToChannelUpdateEvents(stream.userId, async event => {
						if(event.streamTitle.match(/\bbingo\b/i)) {
							this.eventEmitter.emit('trustedStream', stream);
							await this.knownBroadcasterIds.get(stream.userId)?.stop();
							this.knownBroadcasterIds.set(stream.userId, null);
						}
					}));
				}
			}
		} catch (err) {
			BingoBot.logger.error(err);
		}
	}

	private async handleStreamOffline(broadcasterId: string): Promise<void> {
		try {
			this.eventEmitter.emit('broadcasterOffline', broadcasterId);
			await this.knownBroadcasterIds.get(broadcasterId)?.stop();
			this.knownBroadcasterIds.delete(broadcasterId);
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