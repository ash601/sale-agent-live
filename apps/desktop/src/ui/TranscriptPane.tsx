import React from 'react';
import { useOverlayStore } from '../utils/store';

export function TranscriptPane() {
	// what: show streaming transcript lines with speaker tags
	// input: global store transcriptChunks
	// return: JSX pane
	const { transcript } = useOverlayStore();
	return (
		<div className="pane">
			<div className="title">
				<div>Transcript</div>
			</div>
			<div style={{ maxHeight: 220, overflowY: 'auto', lineHeight: 1.35 }}>
				{transcript.map((t) => (
					<div key={t.id}>
						<span className="badge" style={{ marginRight: 6 }}>{t.speaker}</span>
						<span>{t.text}</span>
					</div>
				))}
			</div>
		</div>
	);
}


