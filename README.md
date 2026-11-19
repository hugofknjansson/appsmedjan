# Appsmedjan

Beskriv en app med egna ord och få en riktig, native iPhone-app (SwiftUI) byggd åt dig. Appen körs i en
iOS-simulator som strömmas till webbläsaren, så användaren behöver varken Mac, Xcode eller någon
installation.

"Appsmedjan" är ett arbetsnamn. Det står i `web/src/Logo.tsx`, `web/index.html` och `server/src/prompt.ts`.

## Så hänger det ihop

```
 Webbläsare                    Server (Linux går bra)                  Mac med Xcode
┌──────────────────┐  HTTPS   ┌───────────────────────────┐   WSS    ┌──────────────────────────┐
│ Chatt            │ ───────► │ Konton, projekt, filer    │ ◄─────── │ Byggarbetare (worker/)   │
│ Telefon-         │ ◄─────── │ (SQLite)                  │  jobb,   │  XcodeGen + xcodebuild   │
│ förhandsvisning  │  WSS     │ AI-agent (Claude API)     │  bilder, │  iOS-simulator per app   │
│ Kodvy            │          │ Kö och relä till arbetare │  tryck   │  skärmström + inmatning  │
└──────────────────┘          └───────────────────────────┘          └──────────────────────────┘
```

- **`web/`** React-klient: inloggning, projektlista, chatt, telefonförhandsvisning, kodvy. Svenska och engelska.
- **`server/`** Node-server: REST-API, WebSocket till webbläsare och arbetare, samt AI-agenten.
- **`worker/`** Körs på en Mac. Ansluter *ut* till servern (Macen behöver inga öppna portar), bygger
  projekten, startar appen i en simulator, strömmar skärmen och tar emot tryck och text.
- **`shared/protocol.ts`** Meddelandetyper och valideringsregler som alla tre delar använder.

### AI-agenten

Agenten (`server/src/agent.ts`) är en verktygsloop mot Claudes Messages API med strömmande svar. Den har
sju verktyg: skriva, ändra, läsa och ta bort filer, bygga och köra, titta på skärmen (skärmbild från
simulatorn) och döpa appen. Efter varje ändring bygger den appen, och om kompilatorn klagar får den
felen tillbaka och rättar tills bygget går igenom. Användaren ser aldrig kod eller felmeddelanden, bara
korta förklaringar och en lista med steg.

Modellen är `claude-opus-5-5` med `effort: high` (ändras med `AGENT_MODEL` och `AGENT_EFFORT`).
Anropen har serverstyrd reserv vid avböjda svar (`fallbacks: "default"`) och prompt-cachning påslagen.
Loopen körs i den egna servern eftersom alla verktyg arbetar mot serverns databas och Mac-arbetaren.
Ett alternativ är Claude Managed Agents, där Anthropic kör loopen; det är inte använt här.

### Vad de genererade apparna kan

SwiftUI för iPhone, iOS 17+, enbart Apples egna ramverk (SwiftData, Charts, MapKit med flera). Data
sparas på enheten. Xcode-projektet genereras med XcodeGen från filerna under `Sources/`, så agenten
behöver aldrig röra projektfilen.

Inte stöd ännu: bilder och andra resurser, tredjepartspaket, och allt som kräver Info.plist-nycklar
eller capabilities (kamera, plats, pushnotiser, HealthKit, Sign in with Apple, köp i appen, widgets).
Agenten vet om det och bygger närmaste fungerande variant.

## Kom igång

Kräver Node 22.13 eller senare.

```bash
npm install
```

```bash
cp .env.example .env
```

Fyll i `ANTHROPIC_API_KEY` och ett långt slumpat `WORKER_TOKEN` i `.env`. Sätt gärna `INVITE_CODE` också,
annars kan vem som helst som når sidan skapa konto och förbruka API-krediter.

### Prova utan Mac

En låtsasarbetare bygger "allt" på en sekund och visar en ritad platshållarskärm. Den är till för att
utveckla webb och server, inte för att se riktiga appar.

```bash
npm run dev:server
```

```bash
npm run dev:mock-worker
```

```bash
npm run dev:web
```

Öppna sedan http://localhost:5173.

### Koppla in en Mac

På Macen (Apple silicon rekommenderas):

1. Installera Xcode från App Store, starta det en gång och installera en iOS-simulator
   (Xcode > Settings > Components).
2. Installera verktygen:

   ```bash
   brew install node xcodegen
   ```

   ```bash
   brew tap facebook/fb && brew install idb-companion && pip3 install fb-idb
   ```

   `idb` behövs för tryck, svep och text i förhandsvisningen och för en jämn bildström. Utan det
   fungerar förhandsvisningen ändå, men som enbart visning med några bilder per sekund.
3. Hämta koden, kör `npm install`, och starta arbetaren:

   ```bash
   SERVER_URL=wss://din-domän.se WORKER_TOKEN=samma-som-på-servern npm run worker
   ```

   Lokalt räcker `npm run worker` (den ansluter till `ws://localhost:8787`).

Inställningar: `MAX_SIMULATORS` (standard 2, varje simulator tar ett par GB minne) och `SIM_DEVICE`
(till exempel `iPhone 16`; annars väljs nyaste vanliga iPhone-modellen). Flera Macar kan ansluta till
samma server; nya projekt hamnar på den minst belastade.

### Drift

```bash
npm run build && NODE_ENV=production npm start
```

Servern lyssnar på `PORT` (8787) och serverar även den byggda webbklienten. Lägg den bakom en omvänd
proxy med HTTPS som släpper igenom WebSocket (`/ws` och `/worker`), och sätt `TRUST_PROXY=1`. Proxyn ska
skicka vidare `Host` (eller `X-Forwarded-Host`) oförändrad, annars avvisas webbläsarens WebSocket. Databasen
är en SQLite-fil i `data/`; ta backup på den.

## Tester

```bash
npm test
```

```bash
npm run build && npm run test:e2e
```

`test:e2e` startar servern, låtsasarbetaren och en skriptad ersättare för Claude-API:t, och kör hela
flödet i en riktig webbläsare: konto, ny app, agentens skriv-bygg-rätta-loop, bildström, tryck och text,
kodvy och åtkomstkontroll mellan konton. Det kräver att Playwright finns installerat (`npm i -g playwright`
eller motsvarande).

### Vad som inte är testat

Koden i `worker/src/xcode.ts`, `stream.ts` (delen som pratar med `idb` och `simctl`) har **inte körts på
en riktig Mac**. Den är skriven mot dokumenterade kommandon i `xcodebuild`, `xcrun simctl`, XcodeGen och
`idb`, och hjälpfunktionerna är enhetstestade, men räkna med justeringar första gången den körs.
Troligaste ställena: flaggorna till `idb video-stream` (arbetaren faller automatiskt tillbaka på
skärmbilder om strömmen inte ger bilder), och hur fel plockas ur `xcodebuild`-utskriften.
Agenten har inte heller körts mot det riktiga Claude-API:t, bara mot ersättaren.

## Säkerhet

- **En simulator är ingen sandlåda.** Appar i iOS-simulatorn körs som vanliga processer på Macen med
  arbetarens användarrättigheter. Koden skrivs av AI-modellen utifrån vad användare ber om, så
  behandla den som opålitlig: kör arbetaren på en Mac som bara används till detta, under ett eget
  konto utan administratörsrätt, utan hemligheter på disken (särskilt inte App Store Connect-nycklar).
  För en publik tjänst bör varje användarsession få en egen kortlivad macOS-VM (Tart, Anka eller
  Apples Virtualization-ramverk).
- Arbetare autentiseras med `WORKER_TOKEN`. Alla som har den kan ta emot användares kod och skicka
  bilder till deras webbläsare.
- Lösenord lagras med scrypt, sessioner som HttpOnly-kakor med SameSite=Lax. WebSocket-anslutningar från
  andra webbplatser avvisas.
- Filsökvägar från modellen valideras både i servern och i arbetaren (endast under `Sources/`, endast
  kända filändelser).
- `DAILY_MESSAGE_LIMIT` begränsar antal meddelanden per användare och dygn. Varje meddelande kan kosta
  en hel del tokens, så håll koll på förbrukningen i Anthropic-konsolen.

## Nästa steg

1. Kör arbetaren på en Mac och justera det som behövs (se ovan).
2. Versionshistorik och "ångra" per meddelande.
3. Appikon, bilder och färgtema (asset-katalog), samt Info.plist-nycklar så att kamera, plats med mera
   kan användas.
4. Ladda ner projektet som Xcode-projekt.
5. Isolerade macOS-VM:er per session och en kö när alla simulatorer är upptagna.
6. Betalning och kvoter.

### Publicering via ditt utvecklarkonto

Tekniskt är vägen: arbetaren bygger ett arkiv med `xcodebuild archive`, signerar med ditt teams
distributionscertifikat och laddar upp med App Store Connect-API:t (API-nyckel på en separat, låst
signeringsmaskin, aldrig på byggmaskinen där användarkod körs). Projektet har redan ett unikt
bundle-id per app (`BUNDLE_ID_PREFIX`).

Innan det byggs behöver du ta ställning till Apples regler, som påverkar upplägget mer än tekniken:

- **App Review-riktlinje 4.2.6** säger att appar skapade med en kommersiell mall- eller
  appgenereringstjänst avvisas om de inte skickas in direkt av den som står för appens innehåll, och
  att sådana tjänster inte ska skicka in appar åt sina kunder. Att publicera användarnas appar under
  ditt konto är alltså just det upplägg riktlinjen pekar ut. Läs den aktuella lydelsen och överväg att
  fråga Apple innan du satsar på det.
- **Du blir juridiskt ansvarig** för allt som publiceras under kontot: innehåll, integritetsuppgifter,
  exportregler, och skatt och utbetalningar om appar tar betalt. En regelöverträdelse i en enda app kan
  drabba hela kontot och därmed alla användares appar.
- **TestFlight** är ett rimligt första steg: användaren kan få sin app på sin egen telefon utan
  butiksgranskning av varje version (extern testning kräver en enklare betagranskning). Även detta
  sker under ditt konto och ditt ansvar.
- Alternativet som följer riktlinjen är att hjälpa användaren att publicera under **sitt eget** konto:
  de skapar kontot (det steget kan inte automatiseras bort), ger tjänsten en App Store Connect-API-nyckel,
  och tjänsten sköter signering och uppladdning åt dem.
