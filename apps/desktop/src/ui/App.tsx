import React, { useEffect } from 'react';
import { TranscriptPane } from './TranscriptPane';
import { SuggestionsPane } from './SuggestionsPane';
import { useOverlayStore } from '../utils/store';
import { startSession } from '../utils/session';
import { ProfileBar } from './ProfileBar';

export function App() {
	// what: overlay shell, device and status indicators, panes
	// input: none (internal store)
	// return: JSX overlay root
	const { connected, profileName } = useOverlayStore();
	useEffect(() => {
		// start session on mount for MVP; later attach to a button
		startSession().catch(() => {/* surface errors in future UI */});
		const key = (e: KeyboardEvent) => {
			if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 's') {
				e.preventDefault();
				const first = useOverlayStore.getState().suggestions[0];
				if (first) navigator.clipboard.writeText(first.text);
			}
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
	}, []);
	return (
		<div className="overlay">
			<div className="title">
				<div>Sales Assistant {connected ? <span className="badge">live</span> : <span className="badge">idle</span>}</div>
				<div className="mono">{profileName}</div>
			</div>
			<div className="row">
				<div className="grow">
					<ProfileBar />
				</div>
			</div>
			<div className="row">
				<div className="grow">
					<TranscriptPane />
				</div>
			</div>
			<div className="row">
				<div className="grow">
					<SuggestionsPane />
				</div>
			</div>
		</div>
	);
}


