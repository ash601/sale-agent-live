/* what: simple energy-based VAD to gate audio capture
 * input: AudioContext + MediaStreamTrack
 * return: boolean observable via callback when speech is detected
 */
export function createVad(context: AudioContext, stream: MediaStream, onVoice: (speaking: boolean) => void) {
	const source = context.createMediaStreamSource(stream);
	const analyser = context.createAnalyser();
	analyser.fftSize = 2048;
	source.connect(analyser);
	const data = new Uint8Array(analyser.frequencyBinCount);
	let speaking = false;
	function tick() {
		analyser.getByteFrequencyData(data);
		let sum = 0;
		for (let i = 0; i < data.length; i++) sum += data[i];
		const avg = sum / data.length;
		const nowSpeaking = avg > 22; // tuned threshold
		if (nowSpeaking !== speaking) {
			speaking = nowSpeaking;
			onVoice(speaking);
		}
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);
	return () => {
		source.disconnect();
		analyser.disconnect();
	};
}


