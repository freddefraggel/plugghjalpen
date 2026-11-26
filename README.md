# Plugghjälpen

En webbapp där grundskoleelever laddar in sitt studiematerial och får ett quiz på innehållet, med både flervalsfrågor och fritextfrågor som rättas av AI. Frågorna kopplas till centralt innehåll i Lgr22.

## Så fungerar det

- **Material:** Word (.docx), PowerPoint (.pptx), PDF, textfiler, inklistrad text och länkar till Wikipedia. Filerna läses direkt i webbläsaren. Google Docs och Presentationer laddas ned som Word/PowerPoint först.
- **AI:** valbar leverantör under Inställningar: Anthropic Claude, Google Gemini, Groq eller OpenRouter. Användaren lägger in sin egen API-nyckel, som bara sparas i webbläsaren (localStorage). Det passar testfasen; när elever ska använda appen behövs en liten backend som håller nyckeln.
- **Lagring:** quizresultat sparas bara lokalt i webbläsaren.
- **Driftsättning:** statisk sajt på GitHub Pages, byggs och publiceras av `.github/workflows/deploy.yml` vid push till `main`. Under repots Settings › Pages ska källan vara "GitHub Actions".

## Utveckling

```bash
npm install
npm run dev      # startar på http://localhost:5173/plugghjalpen/
npm test         # enhetstester (vitest)
npm run build    # typkontroll och produktionsbygge i dist/
```

## Kommer senare

- Backend (t.ex. Cloudflare Worker) som håller AI-nyckeln, med skydd mot missbruk, och som kan hämta godtyckliga webbsidor.
- Kursplaner hämtade från Skolverkets öppna API så att kopplingen till Lgr22 bygger på den riktiga texten.
