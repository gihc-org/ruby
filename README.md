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

### Hvorfor COOP og COEP?

COOP og COEP er HTTP-headere, som tilsammen giver siden **cross-origin
isolation**. Det er en browser-sikkerhedsmekanisme, der blandt andet kræves for
at eksponere `SharedArrayBuffer`.

- **COOP** står for **Cross-Origin-Opener-Policy**. Værdien `same-origin`
  isolerer sidens browsing context fra vinduer med en anden origin, så de ikke
  kan kontrollere eller kommunikere direkte med sidens `window`.
- **COEP** står for **Cross-Origin-Embedder-Policy**. Værdien `require-corp`
  kræver, at eksterne ressourcer eksplicit tillader indlejring via CORS eller
  `Cross-Origin-Resource-Policy`. Ressourcer fra samme origin er automatisk
  tilladte.

Når begge headere findes på HTML-svaret, kan appen kontrollere:

```javascript
window.crossOriginIsolated === true
```

Ruby-WASM kører i en Web Worker. Når Ruby kalder `gets.chomp`, bliver workerens
læsefunktion blokeret i `Atomics.wait`, indtil hovedtråden skriver input i en
`SharedArrayBuffer` og signalerer med `Atomics.notify`. Ruby-WASM kører
synkront, så input kan ikke erstattes af et almindeligt JavaScript-`Promise`.
Derfor er den delte buffer nødvendig for at kunne vente på input midt i en
Ruby-kørsel.

Uden cross-origin isolation er `SharedArrayBuffer` og den nødvendige
`Atomics.wait`-adfærd ikke tilgængelig på samme måde, og interaktiv
`gets.chomp` virker derfor ikke.

`Cross-Origin-Resource-Policy: same-origin` begrænser samtidig appens assets til
samme origin. Hvis der senere tilføjes eksterne scripts, fonts eller andre
tredjepartsressourcer, skal deres CORS- eller CORP-headere kontrolleres.

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

`nginx.conf` sætter de samme COOP/COEP-headere i produktion. Det er påkrævet for
den delte inputbuffer og dermed for interaktiv `gets.chomp`.

Se [docs/deployment.md](docs/deployment.md) for releaseprocedure, fejlfindings-
kommandoer og de faldgruber, der blev fundet under den første deployment.
