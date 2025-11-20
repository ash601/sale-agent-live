import React from 'react';
import { useOverlayStore } from '../utils/store';

export function SuggestionsPane() {
	// what: show \"speak next\" streaming suggestions with copy
	// input: global store suggestions
	// return: JSX pane
	const { suggestions, copySuggestion } = useOverlayStore();
	return (
		<div className="pane">
			<div className="title">
				<div>Speak Next</div>
				<div className="controls">
					<button className="btn" onClick={() => suggestions[0] && copySuggestion(suggestions[0].text)}>Copy</button>
				</div>
			</div>
			<div style={{ minHeight: 60 }}>
				{suggestions.length === 0 ? <div style={{ color: '#9aa3b2' }}>Waiting…</div> : (
					<div>
						<div className="suggest">{suggestions[0].text}</div>
						{(suggestions[0].citations?.length ?? 0) > 0 && (
							<div style={{ marginTop: 8, fontSize: 12, color:'#9aa3b2' }}>
								Citations: {suggestions[0].citations!.map((c) => <code key={c} className="mono" style={{ marginRight: 6 }}>{c}</code>)}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}


