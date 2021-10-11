import { ApiClient, HelixStream } from '@twurple/api';
import { ClientCredentialsAuthProvider, StaticAuthProvider } from '@twurple/auth';
import { EventSubListener, EventSubStreamOnlineEvent } from '@twurple/eventsub';
import { NgrokAdapter } from '@twurple/eventsub-ngrok';
import { EventEmitter } from 'events';

/**
 * A listener for bingo twitch streams
 */
export default class TwitchStreamListener {
	private readonly eventEmitter = new EventEmitter();
	private readonly client: ApiClient;
	private readonly listener: EventSubListener;
	private readonly trustedStreamers = new Set<string>();
	private knownStreamerIds = new Set<string>();
	private trustedNonBingoStreamers = new Set<string>(); // This is used to continuesly fetch the title in case they change it to Bingo
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
	constructor(clientId: string, clientSecret: string, eventSubSecret: string, trustedStreamers : Array<string>) {

		const auth = new ClientCredentialsAuthProvider(clientId, clientSecret);

		this.client = new ApiClient({authProvider: auth, });
		this.listener = new EventSubListener({
			apiClient: this.client,
			adapter: new NgrokAdapter(),
			secret: eventSubSecret
		})

		this.client.users.getUsersByNames(trustedStreamers).then(users => {
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
		this.trustedStreamers.forEach(streamer => this.listener.subscribeToStreamOnlineEvents(streamer, event => this.handleStreamOnline(event)));
		this.trustedStreamers.forEach(streamer => this.listener.subscribeToStreamOfflineEvents(streamer, event => {
			this.knownStreamerIds.delete(event.broadcasterId);
			this.trustedNonBingoStreamers.delete(event.broadcasterId);
			this.eventEmitter.emit('streamerOffline', event.broadcasterId)
		}));
		
		this.listener.listen();

		this.fetchUntrustedStreams();
		this.refetchTrustedNonBingoStreams();
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
				streams = await this.client.streams.getStreams({game: '27471', type: 'live', after: streams.cursor, limit:100});
			}

			setTimeout(() => this.fetchUntrustedStreams(), 600_000); //fetch every 10 minutes, most streams should be caught by eventsub
		}
		catch (ex) {
			console.log((ex as Error).message)
		}
	}

	private async refetchTrustedNonBingoStreams(): Promise<void> {
		try {
			if(this.trustedNonBingoStreamers.size) {
				let streams = await this.client.streams.getStreams({userId: Array.from(this.trustedNonBingoStreamers), limit: 100});
				while(streams.data.length > 0) {
		
					streams.data.forEach((stream) => this.handleStream(stream));
					streams = await this.client.streams.getStreams({userId: Array.from(this.trustedNonBingoStreamers), after: streams.cursor, limit: 100});
				}
			}
	
			setTimeout(() => this.refetchTrustedNonBingoStreams(), 60_000)
		}
		catch (ex) {
			console.log((ex as Error).message)
		}
	}

	private async handleStreamOnline(event: EventSubStreamOnlineEvent): Promise<void> {
		await this.handleStream(await event.getStream())
	}

	private async handleStream(stream: HelixStream): Promise<void> {
		if(!this.knownStreamerIds.has(stream.userId)) {
			if(stream.title.match(/bingo/i)) {

				this.knownStreamerIds.add(stream.userId);

				if(this.trustedStreamers.has(stream.userId)) {
					this.eventEmitter.emit('trustedStream', stream)
				} else {
					this.eventEmitter.emit('untrustedStream', stream)
				}
			} else if (this.trustedStreamers.has(stream.userId)) {
				this.trustedNonBingoStreamers.add(stream.userId)
			}
		}
	}

	public async destroy(): Promise<void> {
		await this.listener.unlisten()
	}
}