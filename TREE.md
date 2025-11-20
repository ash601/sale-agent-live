# Project Structure

.gitignore

TREE.md

apps/
└── desktop
    ├── index.html
    ├── package-lock.json
    ├── package.json
    ├── src
    │   ├── audio
    │   │   └── vad.ts
    │   ├── main.tsx
    │   ├── styles.css
    │   ├── ui
    │   │   ├── App.tsx
    │   │   ├── ProfileBar.tsx
    │   │   ├── SuggestionsPane.tsx
    │   │   └── TranscriptPane.tsx
    │   ├── utils
    │   │   ├── session.ts
    │   │   └── store.ts
    │   └── webrtc
    │       └── client.ts
    ├── src-tauri
    │   ├── Cargo.toml
    │   └── src
    │       └── main.rs
    ├── tauri.conf.json
    ├── tsconfig.json
    └── vite.config.ts

generate_tree.py

realtime/
├── openai-realtime-console
│   ├── .env
│   ├── .gitignore
│   ├── .prettierrc
│   ├── LICENSE
│   ├── README.md
│   ├── client
│   │   ├── assets
│   │   │   └── openai-logomark.svg
│   │   ├── base.css
│   │   ├── components
│   │   │   ├── App.jsx
│   │   │   ├── Button.jsx
│   │   │   ├── EventLog.jsx
│   │   │   ├── SessionControls.jsx
│   │   │   └── ToolPanel.jsx
│   │   ├── entry-client.jsx
│   │   ├── entry-server.jsx
│   │   ├── index.html
│   │   ├── index.js
│   │   └── pages
│   │       └── index.jsx
│   ├── package-lock.json
│   ├── package.json
│   ├── postcss.config.cjs
│   ├── server.js
│   ├── tailwind.config.js
│   └── vite.config.js
└── package-lock.json

services/
└── agent-api
    ├── .env
    ├── package-lock.json
    ├── package.json
    └── src
        ├── crm
        │   └── index.js
        ├── index.js
        ├── rag
        │   ├── ingest.js
        │   ├── pinecone.js
        │   ├── qdrant.js
        │   └── search.js
        └── tools
            └── index.js

simple-app/
├── README.md
├── app.js
└── index.html

