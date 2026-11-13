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

## Produktion

Produktionsmiljøet kører på GIHC's k3s-cluster:

- URL: <https://ruby.gihc.online>
- Namespace: `ruby`
- Image: `ghcr.io/gihc-org/ruby`
- TLS: Let's Encrypt via cert-manager

Push til `trunk` bygger og scanner et nyt image i GitHub Actions. DNS og
førstegangsdeployment kan gøres med:

```bash
./scripts/create-dns-record.sh
ssh -L 16443:localhost:6443 -N -f hetzner-k3s
KUBECTL_SERVER=https://127.0.0.1:16443 ./scripts/deploy.sh
./scripts/smoke-test.sh
```

`nginx.conf` sætter COOP/COEP på alle svar. Det er påkrævet for den delte
inputbuffer og dermed for interaktiv `gets.chomp` i produktion.
