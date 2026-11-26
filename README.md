# Plugghjälpen

En webbapp där grundskoleelever laddar in sitt studiematerial och får ett quiz på innehållet, med både flervalsfrågor och fritextfrågor som rättas av AI. Frågorna kopplas till centralt innehåll i Lgr22.

## Så fungerar det

- **Material:** Word (.docx), PowerPoint (.pptx), PDF, textfiler, inklistrad text och länkar till Wikipedia. Filerna läses direkt i webbläsaren. Google Docs och Presentationer laddas ned som Word/PowerPoint först.
- **AI:** valbar leverantör under Inställningar: Anthropic Claude, Groq eller OpenRouter. Under "Testa anslutningen" hämtas vilka modeller nyckeln har tillgång till, och appen byter själv till en som fungerar om den valda inte finns. Användaren lägger in sin egen API-nyckel, som bara sparas i webbläsaren (localStorage). Det passar testfasen; för eleverna finns en backend som håller nyckeln (se nedan).
- **Lagring:** quizresultat sparas bara lokalt i webbläsaren.
- **Driftsättning:** statisk sajt på GitHub Pages, byggs och publiceras av `.github/workflows/deploy.yml` vid push till `main`. Under repots Settings › Pages ska källan vara "GitHub Actions".

## Utveckling

```bash
npm install
npm run dev      # startar på http://localhost:5173/plugghjalpen/
npm test         # enhetstester (vitest)
npm run build    # typkontroll och produktionsbygge i dist/
```

## Läroplanen (Lgr22)

`npm run lgr22` (`scripts/fetch-lgr22.ts`) hämtar grundskolans kursplaner från Skolverkets öppna [Syllabus-API](https://www.skolverket.se/om-oss/oppna-data/api-for-laroplaner-kurs--och-amnesplaner-syllabus) och sparar en förenklad version i `public/lgr22/`: centralt innehåll per stadium (rubriker och punkter) och kunskapskrav. API:t tillåter inte anrop direkt från webbläsare, så datan hämtas när sajten byggs i GitHub Actions, och varje måndag byggs sajten om för att få med eventuella ändringar. Mappen ligger inte i git.

Samma skript hämtar också gymnasiets nya ämnesplaner (GY25, ämnesbetyg med nivåer) till `public/lgr22/gy/`: de 90 gymnasiegemensamma och högskoleförberedande ämnena ("Kapitel 4-ämnen"), inte yrkesämnena. Väljer eleven "Gymnasiet" i stället för en årskurs får hen välja ämne och nivå (t.ex. Matematik, nivå 1c). AI:n får då nivåns centrala innehåll, och resultatsidan visar ämnets betygskriterier för E, C och A. Saknar en nivå delrubriker blir varje punkt ett eget område.

När ett ämne är valt får AI:n hela det centrala innehållet för stadiet och måste märka varje fråga med en av Skolverkets rubriker. Gissar appen ämnet får AI:n rubrikerna för alla ämnen. Resultatsidan visar kunskapskraven (E, C, A) för slutet av stadiet. Saknas datan faller appen tillbaka på AI:ns egen kunskap.

## Backend för eleverna (`worker/`)

En Cloudflare Worker håller AI-nyckeln hemlig så att eleverna inte behöver någon egen. Den kräver klasskod, räknar en dagskvot per enhet och per klasskod (en Durable Object med SQLite) och kan hämta vanliga webbsidor som källor. Själva logiken i `worker/src/handler.ts` använder bara vanliga `Request`/`Response`, så den går att flytta till en annan plattform om det behövs.

- `GET /api/info`: vilken leverantör och modell som används och om klasskod krävs.
- `POST /api/complete`: skickar `{ system, user, maxTokens }` till AI:n.
- `GET /api/fetch-url?url=…`: hämtar en webbsida som text (lokala adresser och IP-adresser nekas).

Inställningar i `worker/wrangler.toml` (leverantör, modell, tillåtna ursprung, kvoter). Hemligheter läggs i GitHub (Settings › Secrets and variables › Actions) och förs över av `.github/workflows/worker.yml`:

| Namn | Typ | Innehåll |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secret | API-token med mallen "Edit Cloudflare Workers" |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Kontots ID (står i Cloudflares översikt) |
| `AI_API_KEY` | secret | Nyckeln till AI-leverantören |
| `CLASS_CODES` | secret | Klasskoder, kommaseparerade, t.ex. `7B-HOST,8A-VINTER` |
| `API_URL` | variable | Workerns adress, t.ex. `https://plugghjalpen-api.<konto>.workers.dev` |

När `API_URL` är satt byggs appen med läget "Skolans server", och eleverna anger bara klasskoden. Egen API-nyckel går fortfarande att välja under Inställningar.

Lokalt: `npx wrangler dev --config worker/wrangler.toml` och `VITE_API_URL=http://localhost:8787 npm run dev`.

## Kommer senare

- Fler sätt att skydda kvoten, t.ex. Cloudflare Turnstile.
