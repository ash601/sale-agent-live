import { createRealtimeClient } from '../webrtc/client';
import { useOverlayStore } from './store';
import { createVad } from '../audio/vad';

export async function startSession() {
	// what: capture stereo audio (prefers Aggregate Device) and connect to Realtime
	// input: none; uses navigator.mediaDevices
	// return: void (side-effects push to store)
	const store = useOverlayStore.getState();
	const devices = await navigator.mediaDevices.enumerateDevices();
	const blackhole = devices.find(d => d.kind === 'audioinput' && /blackhole/i.test(d.label));
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			deviceId: blackhole?.deviceId ? { ideal: blackhole.deviceId } : undefined,
			channelCount: { ideal: 2 },
			sampleRate: 48000,
			noiseSuppression: true,
			echoCancellation: true
		},
		video: false
	});
	const ctx = new AudioContext();
	createVad(ctx, stream, () => { /* could show speaking indicator */ });

	const client = createRealtimeClient({
		tokenUrl: 'http://localhost:8787/realtime/token',
		handlers: {
			onTranscript(speaker, text) {
				store.pushTranscript({ id: `${Date.now()}-${Math.random()}`, speaker, text });
			},
			onSuggestion(text) {
				store.pushSuggestion({ id: `${Date.now()}`, text });
			}
		}
	});
	await client.connect(stream);
}


