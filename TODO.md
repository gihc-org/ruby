# TODO

## Start-prompt til ny session

Kopiér blokken herunder som første besked til en ny coding-agent:

```text
Fortsæt arbejdet på Ruby i browseren i /home/kristiannj/projects/rubyrepl.

Produktionssiden kører på https://ruby.gihc.online. Ruby 3.4 kører client-side
som WebAssembly i en Web Worker. Editoren bruger CodeMirror med Ruby-syntax, og
interaktiv gets.chomp bruger SharedArrayBuffer + Atomics mellem hovedtråden og
workeren. Derfor skal både Vite og Nginx sætte COOP/COEP, og CSP skal tillade
'wasm-unsafe-eval'.

Læs først README.md og docs/deployment.md. Sidstnævnte beskriver den normale
releaseproces og alle fejl, der blev fundet under den første deployment.

Aktuel status:
- GitHub-repo: git@github.com:gihc-org/ruby.git
- Default branch og CI-branch: trunk
- CI-workflow: .github/workflows/publish.yml
- GHCR-image: ghcr.io/gihc-org/ruby
- GHCR-pakken er offentlig og anonym pull er verificeret
- Produktion kører med SHA-tag:
  ghcr.io/gihc-org/ruby:bcb4186152fec21f9fed40054f5cbd66bbc5bc72
- k8s namespace/deployment/service: ruby
- TLS: cert-manager + Let's Encrypt, certificate ruby-gihc-online-tls
- DNS: ruby.gihc.online -> 65.109.233.92
- Seneste kendte CI efter dokumentationscommit bd819a7: grøn

Vigtigt:
- gihc-org er en GitHub User, ikke en Organization. Brug
  https://github.com/gihc-org?tab=packages, ikke /orgs/gihc-org/...
- Ved ny kode-release skal publish-workflowet være grønt, image-SHA'en sættes i
  k8s/deployment.yaml, og deploymentet rulles ud og smoke-testes.
- Brug ikke latest i produktion. Behold SHA-pin og imagePullPolicy IfNotPresent.
- Slå ikke Trivy-scanningssteget fra. Runtime-imaget kører apk upgrade for at
  undgå kendte CVE'er i Alpine-basisimaget.
- Nginx skal fortsat bruge try_files $uri $uri/ =404; ellers giver / 404, selv
  om /healthz virker.
- Bevar COOP/COEP på alle dokument- og asset-svar. Uden cross-origin isolation
  virker interaktiv gets.chomp ikke.
- spil.rb er brugerens lokale testfil og er ikke committet. Ændr, commit eller
  deploy den ikke uden udtrykkelig anmodning.
- Der må ikke ligge hemmeligheder i git. Brug pass til DNS/registry-adgang.

Adgang:
- k3s API er ikke offentligt. Kubeconfig forventes i
  ${KUBECONFIG:-$HOME/.kube/gihc.yml}.
- scripts/deploy.sh bruger KUBECTL_SERVER, når den sættes.
- I den nuværende sandkasse virker SSH via
  SSH_AUTH_SOCK=/run/user/1000/gcr/ssh.
- Netværk, SSH og k3s kræver eskaleret kørsel i sandkassen.

Før ændringer:
1. Kør git status --short --branch og bevar eksisterende brugerændringer.
2. Kør npm test og npm run build.
3. Ved UI- eller WASM-ændringer: test også i rigtig browser, inklusive
   window.crossOriginIsolated === true og et program med gets.chomp.
4. Efter deployment: kør ./scripts/smoke-test.sh mod
   https://ruby.gihc.online.

Næste prioriterede opgaver:
1. Tilføj en vedvarende Playwright-e2e-test i repoet/CI, der starter Ruby,
   verificerer cross-origin isolation og tester gets.chomp. Den nuværende
   automatiske test dækker primært SharedInputChannel.
2. Automatisér eller dokumentér release-flowet efter grøn CI, så image-SHA,
   manifest og deployment holdes synkroniseret uden manuel copy/paste.
3. Overvej performanceforbedringer ved første load: Ruby WASM-asset er cirka
   30 MB (cirka 9 MB gzip), og der bør undersøges preload/cache uden at bryde
   versionering.
4. Følg Dependabot-opdateringer og hold nginx/Node/CodeMirror/Ruby-WASM
   opdaterede; kør Trivy-scanningen ved hver release.

Tag ikke en ny opgave, der ændrer produktionsadfærd, uden at verificere den
offentlige side bagefter.
```

## Aktuelt produktionsbillede

| Område | Status |
| --- | --- |
| Offentlig URL | `https://ruby.gihc.online` |
| DNS | A-record til `65.109.233.92` |
| TLS | `ruby-gihc-online-tls`, Ready |
| k3s | Namespace `ruby`, én kørende replica |
| Image | `ghcr.io/gihc-org/ruby:bcb4186…` |
| GHCR-synlighed | Public |
| CI | Grøn ved seneste kontrol |
| Interaktiv Ruby | Verificeret med `gets.chomp` i browser |

Produktionsmanifestet er bevidst pinnet til det seneste image med
runtime-sikkerhedsrettelser. Senere dokumentationscommits har også fået
image-tags gennem CI, men produktion skal kun flyttes til en ny SHA, når der er
en relevant kodeændring at udrulle.

## Kodekort

| Fil | Ansvar |
| --- | --- |
| `src/main.js` | CodeMirror, UI, worker-kommunikation og terminalinput |
| `src/ruby-worker.js` | Ruby-WASM, WASI, stdout/stderr og blokerende stdin |
| `src/input-channel.js` | SharedArrayBuffer-baseret inputbuffer |
| `src/input-channel.test.js` | Unit-tests af inputkanalen |
| `nginx.conf` | Statisk hosting, WASM MIME, CSP og COOP/COEP |
| `vite.config.js` | COOP/COEP på udviklings- og previewserver |
| `Dockerfile` | Frontend-build og CVE-opdateret Nginx-runtime |
| `k8s/` | Namespace, deployment, service, ingress og NetworkPolicy |
| `.github/workflows/publish.yml` | Test, build, Trivy og GHCR-publicering |
| `docs/deployment.md` | Releaseprocedure og detaljeret fejlhistorik |

## Kendte ikke-blokerende forbedringer

- Browser-e2e er kun kørt manuelt og ligger ikke som en committet Playwright-test.
- Releaseflowet kræver stadig, at den publicerede SHA indsættes i
  `k8s/deployment.yaml`, før deploymentet opdateres.
- Den første indlæsning henter den relativt store Ruby+stdlib WASM-binær.
- Workflow-id’et i `docs/deployment.md` kan ændre sig, hvis workflowet genskabes.

## Definition af en god afslutning

En opgave er først færdig, når:

1. `npm test` og `npm run build` er grønne.
2. Relevante browserflows er testet.
3. `git diff --check` er ren.
4. Produktionsændringer er pushet, CI er grøn, SHA er pinnet, rollout er færdig,
   og `./scripts/smoke-test.sh` består.
5. Eventuelle brugerfiler eller uncommitted ændringer er fortsat intakte.
