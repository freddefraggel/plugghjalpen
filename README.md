# Plugghjälpen

En webbapp där grundskoleelever laddar in sitt studiematerial och får ett quiz på innehållet, med både flervalsfrågor och fritextfrågor som rättas av AI. Frågorna kopplas till centralt innehåll i Lgr22.

## Så fungerar det

- **Material:** Word (.docx), PowerPoint (.pptx), PDF, textfiler, inklistrad text och länkar till Wikipedia. Filerna läses direkt i webbläsaren. Google Docs och Presentationer laddas ned som Word/PowerPoint först.
- **AI:** valbar leverantör under Inställningar: Anthropic Claude, Groq eller OpenRouter. Under "Testa anslutningen" hämtas vilka modeller nyckeln har tillgång till, och appen byter själv till en som fungerar om den valda inte finns. Användaren lägger in sin egen API-nyckel, som bara sparas i webbläsaren (localStorage). Det passar testfasen; när elever ska använda appen behövs en liten backend som håller nyckeln.
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

När ett ämne är valt får AI:n hela det centrala innehållet för stadiet och måste märka varje fråga med en av Skolverkets rubriker. Gissar appen ämnet får AI:n rubrikerna för alla ämnen. Resultatsidan visar kunskapskraven (E, C, A) för slutet av stadiet. Saknas datan faller appen tillbaka på AI:ns egen kunskap.

## Kommer senare

- Backend (t.ex. Cloudflare Worker) som håller AI-nyckeln, med skydd mot missbruk, och som kan hämta godtyckliga webbsidor.
