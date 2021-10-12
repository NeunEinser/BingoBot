import { ApiClient, HelixStream } from '@twurple/api';
import { ClientCredentialsAuthProvider, StaticAuthProvider } from '@twurple/auth';
import { DirectConnectionAdapter, EventSubListener, EventSubStreamOnlineEvent, EventSubSubscription } from '@twurple/eventsub';
import { NgrokAdapter } from '@twurple/eventsub-ngrok';
import { EventEmitter } from 'events';
import BingoBot from './BingoBot';

/**
 * A listener for bingo twitch streams
 */
export default class TwitchStreamListener {
	private readonly eventEmitter = new EventEmitter();
	private readonly client: ApiClient;
	private readonly listener: EventSubListener;
	private readonly trustedStreamers = new Set<string>();
	private knownStreamerIds = new Map<string, EventSubSubscription | null>();
	private ready = false;
	private started = false;

	/** 
	 * Constructs a TwitchStreamListener
	 * @param clientId The twitch client id
	 * @param clientSecret The twitch client secret
	 * @param eventSubSecret The randomly generated eventsubsecret (see
	 * https://dev.twitch.tv/docs/eventsub#secret)
	 * @param trustedStreamers A list of streamers you trust
	*/
	constructor() {
		const config = BingoBot.config
		const auth = new ClientCredentialsAuthProvider(config.twitch.clientId, config.twitch.clientSecret);

		const adapter = !config.ssl ? new NgrokAdapter() : new DirectConnectionAdapter({
			hostName: config.ssl.hostName,
			sslCert: {
				cert: config.ssl.certificate,
				key: config.ssl.key
			}
		});
		this.client = new ApiClient({authProvider: auth, });
		this.listener = new EventSubListener({
			apiClient: this.client,
			adapter: adapter,
			secret: config.twitch.eventSubSecret
		})

		this.client.users.getUsersByNames(config.trustedStreamers).then(users => {
			users.forEach(user => this.trustedStreamers.add(user.id));
			this.ready = true;

			if(this.started)
				this.internalStart();
		})
	}

	/**
	 * Starts the listner.
	 * All listners should be registered when calling this, as events might be
	 * triggered from when this method is called first.
	 */
	public start() {
		if(this.ready)
			this.internalStart()

		this.started = true;
	}

	private async internalStart(): Promise<void> {
		this.trustedStreamers.forEach(streamer => this.listener.subscribeToStreamOnlineEvents(streamer, async event =>
			await this.handleStream(await event.getStream()))
		);
		this.trustedStreamers.forEach(streamer => this.listener.subscribeToStreamOfflineEvents(streamer, async event => {
			this.eventEmitter.emit('streamerOffline', event.broadcasterId);
			await this.knownStreamerIds.get(event.broadcasterId)?.stop();
			this.knownStreamerIds.delete(event.broadcasterId);
		}));
		
		this.listener.listen();

		this.fetchUntrustedStreams();
	}

	/**
	 * The given event handler is called with the stream as argument whenever
	 * a trusted streamer goes live.
	 * @param handler The function being called when a trusted streamer goes live
	 */
	public onTrustedBingoStreamWentLive(handler : (stream: HelixStream) => void) {
		this.eventEmitter.on('trustedStream', handler)
	}
	
	/**
	 * The given event handler is called with the stream as argument whenever
	 * an untrusted streamer goes live.
	 * 
	 * Since the twitch api does not provied a native listner, all streams are
	 * fetched every 10 minutes. This generally means that untrusted streamers
	 * will have a higher delay.
	 * 
	 * @param handler The function being called when an untrusted streamer goes live
	 */
	public onUntrustedBingoStreamWentLive(handler: (stream: HelixStream) => void) {
		this.eventEmitter.on('untrustedStream', handler)
	}
	
	/**
	 * This event is called whenever a trusted bingo streamer goes offline.
	 * 
	 * @param handler The function being called when an untrusted streamer goes live
	 */
	public onStreamerWentOffline(handler : (broadcasterId: string) => void) {
		this.eventEmitter.on('untrustedStream', handler)
	}

	private async fetchUntrustedStreams(): Promise<void> {
		try {
			let streams = await this.client.streams.getStreams({game: '27471', type: 'live', limit: 100});
			while(streams.data.length > 0) {

				streams.data.forEach((stream) => this.handleStream(stream));
				streams = await this.client.streams.getStreams({game: '27471', type: 'live', after: streams.cursor, limit: 100});
			}

			// fetch every 5 hrs. This is meant to just help me update the list of trusted
			// streamers, doesn't have to catch every stream, and doesn't have to be real
			// time. Let's not make Twitch too suspicious of us.
			setTimeout(() => this.fetchUntrustedStreams(), 18_000_000);
		}
		catch (ex) {
			console.log((ex as Error).message)
			setTimeout(() => this.fetchUntrustedStreams(), 18_000_000);
		}
	}

	private async handleStream(stream: HelixStream): Promise<void> {
		if(!this.knownStreamerIds.has(stream.userId)) {
			if(stream.title.match(/\bbingo\b/i)) {

				this.knownStreamerIds.set(stream.userId, null);

				if(this.trustedStreamers.has(stream.userId)) {
					this.eventEmitter.emit('trustedStream', stream);
				} else {
					this.eventEmitter.emit('untrustedStream', stream)
				}
			} else if (this.trustedStreamers.has(stream.userId)) {
				this.knownStreamerIds.set(stream.userId, await this.listener.subscribeToChannelUpdateEvents(stream.userId, async event => {
					if(event.streamTitle.match(/\bbingo\b/i)) {
						this.eventEmitter.emit('trustedStream', stream);
						await this.knownStreamerIds.get(stream.userId)?.stop();
						this.knownStreamerIds.set(stream.userId, null);
					}
				}));
			}
		}
	}

	public async destroy(): Promise<void> {
		await this.listener.unlisten()
	}
}