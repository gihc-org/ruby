# Ruby i browseren

En lille browserbaseret Ruby-editor med syntax highlighting og interaktiv
terminal. Ruby 3.4 kører lokalt via WebAssembly; koden sendes ikke til en server.

## Start

```bash
npm install
npm run dev
```

Åbn adressen, som Vite viser (normalt `http://localhost:5173`), skriv Ruby og
tryk **Kør** eller `Ctrl/⌘ + Enter`.

Når programmet kalder `gets.chomp`, bliver inputfeltet aktivt. Skriv en linje og
tryk `Enter`; linjen sendes til Ruby-programmets standard input.

## Build

```bash
npm run build
npm run preview
```

Den interaktive input kræver `SharedArrayBuffer`, som browseren kun tillader,
når siden er cross-origin isolated. Vite-konfigurationen sætter derfor disse
headers for både udviklingsserveren og preview:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Ved udrulning til en statisk host skal de samme headers konfigureres på
serveren. Hele appen kan hostes statisk, inklusive den medfølgende Ruby WASM-binær.
