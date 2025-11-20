import { create } from 'zustand';

type TranscriptItem = { id: string; speaker: 'you' | 'other'; text: string };
type Suggestion = { id: string; text: string; citations?: string[] };

type OverlayState = {
	connected: boolean;
	profileName: string;
	transcript: TranscriptItem[];
	suggestions: Suggestion[];
	setConnected: (v: boolean) => void;
	pushTranscript: (item: TranscriptItem) => void;
	pushSuggestion: (item: Suggestion) => void;
	copySuggestion: (text: string) => void;
};

export const useOverlayStore = create<OverlayState>((set, get) => ({
	// what: minimal state for overlay rendering and actions
	// input: actions below mutate state
	// return: store API for UI components
	connected: false,
	profileName: 'Default',
	transcript: [],
	suggestions: [],
	setConnected: (v) => set({ connected: v }),
	pushTranscript: (item) => set({ transcript: [...get().transcript.slice(-200), item] }),
	pushSuggestion: (item) => set({ suggestions: [item, ...get().suggestions].slice(0, 10) }),
	copySuggestion: async (text) => {
		await navigator.clipboard.writeText(text);
	}
}));


