# Deployment af ruby.gihc.online

Dette dokument beskriver den aktuelle produktionsopsætning og de faldgruber, der
blev fundet under den første deployment. Formålet er, at en senere release kan
gennemføres og fejlfindes uden at gentage de samme fejl.

## Aktuel opsætning

| Område | Værdi |
| --- | --- |
| URL | `https://ruby.gihc.online` |
| GitHub-repo | `gihc-org/ruby` |
| GitHub-kontotype | Almindelig brugerkonto, ikke GitHub Organization |
| Container-image | `ghcr.io/gihc-org/ruby` |
| Offentligt image-tag | Commit-SHA |
| Kubernetes-namespace/deployment | `ruby` |
| TLS | Let's Encrypt via cert-manager |
| DNS | A-record til `65.109.233.92` |
| CI | `.github/workflows/publish.yml` ved push til `trunk` |

Ruby 3.4 kører som WebAssembly i browseren. Den interaktive terminal kræver
`SharedArrayBuffer`, og derfor skal alle svar fra Nginx have:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

CSP skal desuden tillade WebAssembly-kompilering med `'wasm-unsafe-eval'`.

## Normal release

1. Commit ændringerne og push til `trunk`.

   ```bash
   git push origin trunk
   ```

2. Åbn GitHub Actions og vælg workflowet **Publish container image**. Kontrollér,
   at den kørsel, der hører til den nye commit, er grøn. Kørsler fra
   **Dependabot Updates** er separate og beviser ikke, at imaget blev publiceret.

3. Find det SHA-tag, som workflowet publicerede. GitHub Actions bruger commitens
   fulde SHA:

   ```text
   ghcr.io/gihc-org/ruby:<fuld-commit-sha>
   ```

4. Opdatér image-tagget i `k8s/deployment.yaml`. Brug en SHA i stedet for
   `latest`, så deploymentet er reproducerbart og kan rulles tilbage.

5. Åbn SSH-tunnelen til k3s og deploy:

   ```bash
   ssh -L 16443:localhost:6443 -N -f hetzner-k3s
   KUBECTL_SERVER=https://127.0.0.1:16443 ./scripts/deploy.sh
   ```

6. Verificér den offentlige side:

   ```bash
   ./scripts/smoke-test.sh
   ```

Smoke-testen skal kontrollere både `/`, `/healthz`, 404, COOP/COEP, CSP og TLS.
Et svar fra `/healthz` alene viser ikke, at Nginx kan serve forsiden.

## Førstegangsdeployment

1. Opret DNS-record med `./scripts/create-dns-record.sh`.
2. Push til `trunk`, og vent på en grøn **Publish container image**-kørsel.
3. Gør GHCR-pakken offentlig fra pakkens indstillinger.
4. Sæt SHA-tagget i `k8s/deployment.yaml`.
5. Anvend manifesterne med `./scripts/deploy.sh`.
6. Vent på, at certifikatet `ruby-gihc-online-tls` bliver `Ready`.
7. Kør `./scripts/smoke-test.sh`.

## Hvad gik galt første gang

### 1. Lokal og remote branch var ikke på samme historik

Repoet havde først en lokal `trunk` og en remote `main`. Rebase blev forsøgt med
en uncommitted ændring i `src/styles.css`, hvilket Git afviste:

```text
cannot rebase: You have unstaged changes
```

Rebase kræver et rent arbejdstræ. Løsningen var at committe scrollrettelsen først
og derefter rebase mod remote-historikken. Senere blev `trunk` sat som default
branch på GitHub.

### 2. `gihc-org` blev antaget at være en organisation

Alle links og instruktioner med `/orgs/gihc-org/...` gav 404. Årsagen er, at
`gihc-org` er en almindelig GitHub-brugerkonto:

```text
https://api.github.com/users/gihc-org  -> type: User
https://api.github.com/orgs/gihc-org   -> 404
```

Der findes derfor ingen organisationsejere, medlemsliste eller invitation til
`gihc-org`. Pakker skal administreres fra brugerprofilen:

```text
https://github.com/gihc-org?tab=packages
```

Den konto, der skal ændre pakkesynlighed, er selve `gihc-org`-kontoen. Adgang
til et offentligt repo eller en SSH-nøgle giver ikke adgang til kontoens private
pakkeindstillinger.

### 3. Grønne Dependabot-kørsler blev forvekslet med en grøn image-publish

Actions-siden viste flere grønne kørsler for samme commit, men de tilhørte
**Dependabot Updates**. Den faktiske **Publish container image**-kørsel fejlede.
Derfor blev der aldrig oprettet en `ruby`-pakke, og pakkesiden gav 404.

Kontrollér altid workflow-navnet og den tilhørende commit. En grøn kørsel i en
anden workflow end publish-workflowet betyder ikke, at der findes et nyt image.

### 4. Trivy stoppede publiceringen på grund af basis-imagets pakker

Publish-workflowet fejlede i **Scan image for known vulnerabilities**. Runtime-
imaget `nginx-unprivileged:1.31-alpine` indeholdt 13 rettede sårbarheder:

- 1 CRITICAL
- 12 HIGH

Fejlen var blandt andet i `brotli-libs`, `curl`, `libexpat`, `libxslt`, `musl`
og `zlib`. Publish-steget blev korrekt ikke kørt.

Løsningen er at opdatere Alpine-pakkerne i runtime-laget:

```dockerfile
FROM docker.io/nginxinc/nginx-unprivileged:1.31-alpine

USER root
RUN apk upgrade --no-cache
USER 101
```

Herefter skal Trivy med samme konfiguration give 0 fund på `CRITICAL` og `HIGH`.
Det er bedre at rette runtime-pakkerne end at deaktivere scanningssteget.

### 5. Pakken var ikke skjult – den fandtes ikke

Når GHCR returnerer 403 for anonym tokenudstedelse, betyder det ikke altid, at
en privat pakke eksisterer. En aldrig oprettet pakke giver samme adgangsafvisning.
Afgørende rækkefølge:

1. Kontrollér, at publish-workflowet er grønt.
2. Kontrollér, at image-push-steget blev udført.
3. Kontrollér, at pakken står i `https://github.com/gihc-org?tab=packages`.
4. Først derefter ændres visibility.

“Inherit access from source repository” giver adgang til repoets brugere. Det gør
ikke pakken anonymt læsbar. Pakken skal eksplicit have visibility **Public**.

### 6. Nginx gav 404 på forsiden, mens health virkede

Første Nginx-konfiguration brugte:

```nginx
location / {
    try_files $uri =404;
}
```

Rodstien `/` er en mappe, ikke en fil. `/healthz` havde en separat location og
virkede derfor, mens `/` gav 404. Den korrekte statiske fallback er:

```nginx
location / {
    try_files $uri $uri/ =404;
}
```

### 7. Privat GHCR-pakke under bootstrap

Mens pakken endnu ikke kunne gøres offentlig, blev et lokalt bygget image
importeret direkte i k3s som et midlertidigt fallback. Det fik siden online, men
er ikke den normale deployvej.

Produktion bruger nu det offentlige GHCR-image. Fremtidige releases skal følge
den normale CI- og SHA-pinprocedure ovenfor.

## Kendte fælder

| Fælde | Konsekvens | Undgå ved |
| --- | --- | --- |
| Workflow triggerer kun `main` | Push til `trunk` bygger intet image | Hold workflowets branch i sync med default branch |
| Kun at kigge på grønne Actions-kørsler | Dependabot kan være grøn, mens publish fejler | Vælg workflowet **Publish container image** |
| Trivy-fejl ignoreres | Intet image eller GHCR-pakke oprettes | Ret CVE’erne og scan lokalt før push |
| `/orgs/gihc-org/...` bruges | 404, fordi `gihc-org` er en brugerkonto | Brug `github.com/gihc-org?tab=packages` |
| “Inherit access” forveksles med public | k3s får 403 ved image pull | Sæt visibility **Public** |
| `latest` bruges i produktion | Deploymentet er ikke reproducerbart | Pin commit-SHA |
| `imagePullPolicy: Always` med SHA | Unødvendig registry-kontakt ved hver start | Brug `IfNotPresent` med immutable SHA |
| Kun `/healthz` testes | Nginx-routingfejl på `/` opdages ikke | Kør hele smoke-testen |
| COOP/COEP mangler | `SharedArrayBuffer` og interaktiv input fejler | Bevar headers i både Vite og Nginx |
| CSP mangler `wasm-unsafe-eval` | Ruby-WASM kan ikke kompileres | Kontrollér CSP i smoke-testen |
| Lokal `spil.rb` committes | Brugerens testkode havner i repoet | Hold den uden for Git og Docker-build |

## Fejlfindingskommandoer

Kontrollér den offentlige side og headere:

```bash
curl -sS -D - https://ruby.gihc.online/ -o /dev/null
curl -sS https://ruby.gihc.online/healthz
./scripts/smoke-test.sh
```

Kontrollér om GHCR-pakken er anonymt læsbar:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://ghcr.io/token?scope=repository:gihc-org/ruby:pull'
```

`200` betyder, at registry-token kan udstedes. `403` betyder typisk privat eller
manglende pakke og skal undersøges sammen med CI-status.

Kontrollér deployment og certifikat:

```bash
kubectl -n ruby get deployment,pods,service,ingress,certificate -o wide
kubectl -n ruby rollout status deployment/ruby
kubectl -n ruby get certificate ruby-gihc-online-tls
```

Kontrollér workflows fra GitHub API:

```bash
curl -fsS \
  'https://api.github.com/repos/gihc-org/ruby/actions/workflows/417844002/runs?branch=trunk&per_page=1'
```

Workflow-id’et kan ændres, hvis workflowet genskabes. Slå det op med:

```bash
curl -fsS 'https://api.github.com/repos/gihc-org/ruby/actions/workflows'
```
