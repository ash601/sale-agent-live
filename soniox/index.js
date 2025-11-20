import { SonioxClient } from '@soniox/speech-to-text-web';

const sonioxClient = new SonioxClient({
    // Your Soniox API key or temporary API key.
    apiKey: '99dfab41eb81dc9f6eaa07ed586e1d1ce8a74fe147a89fd3bf51e80ecc72e042',
});

sonioxClient.start({
    // Select the model to use.
    model: 'stt-rt-preview',

    // Set language hints when possible to significantly improve accuracy.
    languageHints: ['en', 'es'],

    // Context is a string that can include words, phrases, or sentences to improve the
    // recognition of rare or specific terms.
    context: {
        general: [
            { key: 'domain', value: 'Healthcare' },
            { key: 'topic', value: 'Diabetes management consultation' },
        ],
        terms: ['Celebrex', 'Zyrtec', 'Xanax', 'Prilosec', 'Amoxicillin Clavulanate Potassium'],
    },

    // Enable speaker diarization. Each token will include a "speaker" field.
    enableSpeakerDiarization: true,

    // Enable language identification. Each token will include a "language" field.
    enableLanguageIdentification: true,

    // Use endpoint detection to detect when a speaker has finished talking.
    // It finalizes all non-final tokens right away, minimizing latency.
    enableEndpointDetection: true,

    // Callbacks when the transcription starts, finishes, or encounters an error.
    onError: (status, message) => {
        console.error(status, message);
    },
    // Callback when the transcription returns partial results (tokens).
    onPartialResult(result) {
        console.log('partial result', result.tokens);
    },
});
