/* what: minimal WebRTC client to OpenAI Realtime API with stereo stream support
 * input: token endpoint URL, selected MediaStream (stereo), event handlers
 * return: functions to connect, disconnect, and send datachannel messages
 */
import { useOverlayStore } from '../utils/store';

type Handlers = {
	onTranscript?: (speaker: 'you'|'other', text: string) => void;
	onSuggestion?: (text: string) => void;
};

export function createRealtimeClient(opts: { tokenUrl: string; handlers: Handlers }) {
	const store = useOverlayStore.getState();
	let pc: RTCPeerConnection | null = null;
	let dc: RTCDataChannel | null = null;

	async function connect(stream: MediaStream) {
		// guard if already connected
		if (pc) return;
		const tokenResp = await fetch(opts.tokenUrl, { method: 'POST' });
		if (!tokenResp.ok) throw new Error('failed to fetch realtime token');
		const { client_secret, url } = await tokenResp.json(); // {client_secret:{value:string},url:string}

		pc = new RTCPeerConnection({
			iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
		});

		// data channel for JSON events
		dc = pc.createDataChannel('oai-events');
		dc.onmessage = (ev) => {
			try {
				const msg = JSON.parse(ev.data);
				if (msg.type === 'transcript.delta') {
					const speaker: 'you'|'other' = msg.channel === 0 ? 'you' : 'other';
					opts.onTranscript?.(speaker, msg.text);
				} else if (msg.type === 'suggestion.delta') {
					opts.onSuggestion?.(msg.text);
				}
			} catch { /* ignore non-json */ }
		};

		// add audio track(s)
		for (const track of stream.getAudioTracks()) {
			pc.addTrack(track, stream);
		}

		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);

		const sdpResp = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${client_secret.value}`,
				'Content-Type': 'application/sdp'
			},
			body: offer.sdp
		});
		if (!sdpResp.ok) throw new Error('realtime sdp exchange failed');
		const answer = { type: 'answer', sdp: await sdpResp.text() } as RTCSessionDescriptionInit;
		await pc.setRemoteDescription(answer);

		store.setConnected(true);
	}

	async function disconnect() {
		if (dc) { dc.close(); dc = null; }
		if (pc) { pc.close(); pc = null; }
		useOverlayStore.getState().setConnected(false);
	}

	return { connect, disconnect };
}


