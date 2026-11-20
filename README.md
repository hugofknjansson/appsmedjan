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

Inte stöd ännu: egna bilder och andra resurser (appikonen är en genererad platshållare), tredjepartspaket, och allt som kräver Info.plist-nycklar
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

### Hyrda Macar

Arbetaren behöver inte köras på din egen dator. En hyrd Mac i ett datacenter fungerar likadant: den
ansluter utåt till servern, så det enda den behöver är internet. `scripts/mac-worker.sh` sätter upp
arbetaren så att den sköter sig själv: den startar vid inloggning, startas om ifall den stannar, loggar
till `~/Library/Logs/appsmedjan-worker.log` och rensar bort simulatorer och byggmappar som inte använts
på 14 dagar (`PRUNE_AFTER_DAYS`).

Vad som finns att hyra (priser från leverantörernas sidor i november 2026, kontrollera före köp):

| Leverantör | Minsta maskin | Pris | Bindning | Plats |
|---|---|---|---|---|
| Scaleway | Mac mini M4, 16 GB, 256 GB | 0,22 €/timme, cirka 149 €/månad | 24 timmar | Paris |
| MacStadium | Mac mini M4, 16 GB, 256 GB | 149 $/månad | per månad, i förskott | ej angivet |
| OakHost | Mac mini M6, 16 GB, 256 GB | 120 €/månad exkl. moms | per månad, 14 dagars ångerrätt på första beställningen | Tyskland |

Scaleway är enklast att börja med, eftersom en provdag kostar runt 5 €. En Mac går inte att stänga av
mellan användningarna för att spara pengar: den kostar lika mycket oavsett om någon bygger.

Räkna med ungefär 4 GB minne per simulator som är igång, utöver 6 GB till macOS och byggen: 16 GB räcker
till 2 simulatorer åt gången, 24 GB till 4. Skriptet föreslår ett värde för `MAX_SIMULATORS` utifrån
Macens minne. Behövs mer hyr du en Mac till; servern lägger nya projekt på den minst belastade.

Så här sätter du upp en ny Mac, över SSH eller skärmdelning:

1. Installera Xcode. Det kräver ett Apple-konto och går inte att skripta helt. Antingen via App Store
   över skärmdelning, eller i terminalen:

   ```bash
   brew install xcodesorg/made/xcodes && xcodes list
   ```

   Välj den nyaste version som Macens macOS klarar, och installera den med `xcodes install <version>`.
   Xcode 27 kräver macOS Tahoe 26.6 eller senare; på macOS Sequoia 15.6 är Xcode 26.3 den nyaste som
   går att köra. Scaleways Macar levereras med Sequoia om du inte väljer något annat i beställningen.
   Apparna som byggs här riktar sig mot iOS 17, så båda fungerar.

   ```bash
   xcodes install 26.3
   ```

   Över SSH är nyckelringen låst, och då kan xcodes inte spara inloggningen. Lås upp den i samma
   kommando: `security unlock-keychain ~/Library/Keychains/login.keychain-db && xcodes install <version>`.
   xcodes godkänner licensen och gör förstagångsinställningen själv, men lägger Xcode under ett namn
   med versionsnummer, så peka ut det och hämta simulatorn:

   ```bash
   sudo xcode-select -s /Applications/Xcode-<version>.app && xcodebuild -downloadPlatform iOS
   ```

2. Se till att användaren som ska köra arbetaren är inloggad på skrivbordet, med automatisk inloggning
   påslagen, och att Macen inte går i vila (`sudo pmset -a sleep 0 disksleep 0 displaysleep 0`).
   Simulatorer startar inte utan en skrivbordssession.
3. Hämta koden och kontrollera läget. `check` ändrar ingenting och säger vad som saknas:

   ```bash
   git clone https://github.com/hugofknjansson/appsmedjan.git && cd appsmedjan && scripts/mac-worker.sh check
   ```

4. Installera verktygen och starta arbetaren. Skriptet frågar efter `WORKER_TOKEN` (samma som på servern)
   utan att visa det:

   ```bash
   scripts/mac-worker.sh install --server wss://din-server.example
   ```

5. Serverns logg visar arbetaren som ansluten. Därefter: `scripts/mac-worker.sh status`, `logs`,
   `restart`, och `update` för att hämta ny kod och starta om.

**Håll nycklar borta från användarnas kod.** Appar i simulatorn körs som arbetarens macOS-användare
och kan läsa den användarens filer. Kör därför förhandsvisningar och uppladdningar till TestFlight
under två olika användare på Macen (eller på två Macar): en som installeras med `--role preview` och
inte har några nycklar, och en med `--role signing` som har Apple-nyckeln men aldrig kör simulatorer.

Signeringsanvändaren loggar aldrig in på skärmen, så dess arbetare körs som en systemtjänst.
`scripts/mac-signer.sh` sköter det som kräver administratör:

1. Från administratörens konto: `sudo scripts/mac-signer.sh create-user`. Skapar användaren `signer`,
   stänger dess hemkatalog för andra och låter dina SSH-nycklar logga in som den.
2. Som `signer` (över SSH): hämta koden, lägg `.p8`-nyckeln i `~/.appstoreconnect/private_keys/`
   och Apple-uppgifterna i `.env`, och kör sedan

   ```bash
   scripts/mac-worker.sh install --server wss://din-server.example --role signing --skip-tools && scripts/mac-worker.sh keychain
   ```

   `keychain` skapar en egen nyckelring för signeringen. Inloggningsnyckelringen är låst utan
   skärmsession, och Xcode behöver någonstans att lägga utvecklingscertifikatet det skapar.
   `scripts/run-worker.sh` låser upp den vid varje start.
3. Från administratörens konto: `sudo scripts/mac-signer.sh install-daemon`. Startar arbetaren vid
   uppstart, som `signer`.

Två saker i tjänstens miljö skiljer sig från en SSH-session, och skriptet hanterar båda:

- En systemtjänst delar systemets säkerhetssession, där bara systemets nyckelring genomsöks. Tjänsten
  får därför en egen session (`SessionCreate`), annars hittar Xcode inte certifikatets privata nyckel.
- Signaturen kontrolleras av systemets betrodda tjänst, som inte ser användarens nyckelring. Apples
  mellanliggande certifikat (WWDR G3 och G6) läggs därför i systemets nyckelring, annars stannar
  `codesign` med "unable to build chain to self-signed root" och `errSecInternalComponent`.

Allt detta är kört på en hyrd Mac mini M6 hos OakHost (macOS 27.2, Xcode 27.2): en användare med
`--role preview` som bygger, startar simulatorn, tar emot tryck och text och strömmar bild, och en
med `--role signing` som har laddat upp ett bygge till TestFlight. Tre saker att känna till därifrån:

- Maskinen levereras med lösenordsinloggning över SSH. Lägg in en nyckel med `ssh-copy-id` först.
- Homebrew, `xcodes install`, `xcode-select` och `mac-signer.sh` frågar efter administratörslösenordet
  och måste köras i en egen terminal (`ssh -t`). Resten går att köra utan.
- `sudo sysadminctl -autologin set` över SSH gav fel (`SACSetAutoLoginPassword error:22`). Slå på
  automatisk inloggning i Systeminställningar över skärmdelning i stället.

Inte provat: en omstart av Macen, och uppladdning med en användares eget anslutna Apple-konto från
signeringstjänsten.

### Skicka appar till TestFlight

Knappen "Till TestFlight" i en app bygger en signerad version och laddar upp den till **ditt eget**
Apple-utvecklarkonto, så att den kan installeras på en riktig iPhone via TestFlight-appen. Det kräver
ett betalt medlemskap i Apple Developer Program. Funktionen är avstängd tills stegen nedan är gjorda.

1. Skapa en API-nyckel i App Store Connect (Users and Access > Integrations > App Store Connect API).
   Rollen Admin fungerar; snävare roller kan sakna rätt att skapa certifikat och profiler. Ladda ner
   `.p8`-filen (det går bara en gång) och notera Key ID och Issuer ID.
2. På Macen som ska ladda upp, lägg till i `.env` och starta om arbetaren:

   ```
   APPLE_TEAM_ID=ABCDE12345
   ASC_KEY_ID=...
   ASC_ISSUER_ID=...
   ASC_KEY_PATH=~/hemligt/AuthKey_....p8
   ```

   Arbetaren skriver `TestFlight uploads are on` när nyckeln hittas, och servern visar `testflight: yes`.
3. På servern, ange vilka konton som får använda knappen (allt som laddas upp hamnar under ditt
   utvecklarkonto och ditt ansvar): `TESTFLIGHT_USERS=du@example.com,testare@example.com`, eller `*` för alla.
4. Första gången för varje app: tryck på knappen. Arbetaren registrerar appens bundle-id i
   utvecklarkontot (via App Store Connect-API:t) och väntar sedan i upp till en kvart på att appen ska
   skapas, eftersom Apple inte har något API för det. Webbklienten visar under tiden vilket bundle-id som
   ska väljas. Skapa appen i App Store Connect (Apps > + > New App, iOS, välj bundle-id:t i listan), så
   fortsätter uppladdningen av sig själv. Hinner du inte får du trycka på knappen igen.
5. Kontoägaren läggs automatiskt till som intern TestFlight-testare, i en grupp som heter "Appsmedjan"
   och får alla byggen. När Apple har bearbetat bygget (några minuter) dyker appen upp i TestFlight-appen
   på telefonen, utan granskning. Går det inte (nyckelns roll får till exempel inte lista användare) säger
   webbklienten att testaren får läggas till för hand. Externa testare kräver en betagranskning av Apple
   och bjuds in för hand i App Store Connect.

Varje uppladdning får versionsnummer 1.0 och ett byggnummer av datum och klockslag (UTC). Apparna får en
automatiskt genererad ikon i en färg per app, eftersom App Store Connect inte tar emot appar utan ikon.

Tänk på att nyckeln ger åtkomst till ditt utvecklarkonto och att appar i simulatorn kan läsa filer som
arbetarens användare kommer åt (se Säkerhet). På en Mac där bara du själv bygger appar är det rimligt.
För fler användare bör uppladdningen ligga på en egen Mac eller ett eget macOS-konto som inte kör
simulatorer. Starta den arbetaren med `PREVIEWS=0`: då tar den bara emot uppladdningar och kör aldrig
simulatorer, och servern skickar förhandsvisningarna till de andra arbetarna.

Mot Apple med en riktig nyckel är det här kört: registrering av bundle-id, signering och en uppladdning
som gick hela vägen till TestFlight. Väntan på att appen skapas och det automatiska tillägget av testare
är provade mot låtsasarbetaren och enhetstestade. Tillägget av testare har gått igenom mot Apple utan
fel vid en riktig uppladdning, men loggen visar inte om det då skapade en ny testgrupp eller använde en
som redan fanns, så den grenen kan vara oprövad. Räkna med justeringar där, och i
hur fel från `xcodebuild` tolkas (`classifyPublishFailure` i `worker/src/publish.ts`); arbetarens logg
visar alltid verktygens egna felutskrifter.

### Appens sida i App Store

Knappen **App Store** i ett projekt öppnar en guide som förbereder det som syns i butiken och skickar
det till App Store Connect, till samma konto som TestFlight-uppladdningarna går till:

- **Texter**: namn, underrubrik, kampanjtext, beskrivning, sökord, kategori och länkar, med Apples
  teckengränser. "Föreslå texter från appen" låter Claude skriva ett förslag utifrån appens kod, på
  appens eget språk. Förslaget sparas inte förrän personen har läst det och tryckt Spara.
- **Skärmbilder**: knappen "App Store-bild" under förhandsvisningen sparar det som visas just då.
  Bilden tas i simulatorn och skalas till storleken Apple kräver för den största iPhonen
  (1320 × 2868), så ingen större simulator behöver köras. Högst tio.
- **Ikon**: en egen PNG på 1024 × 1024 används från nästa TestFlight-uppladdning. Genomskinlighet
  fylls med vitt, eftersom Apple inte godkänner den.
- **Skicka**: arbetaren som har kontots nyckel fyller i versionens texter på appens primära språk,
  byter ut skärmbilderna, sätter kategorin och väljer det senast uppladdade bygget.

Inget skickas in för granskning härifrån. Det som Apple inte har något API för, eller som den som
äger kontot själv måste stå för, görs i App Store Connect: integritetsfrågorna, åldersgräns, pris,
kontaktuppgifter för granskningen och själva inskicket. Guiden listar de stegen.

Begränsningar i den här versionen: bara appens primära språk, bara en första version (en app som
redan är släppt eller granskas lämnas orörd), och bara iPhone-skärmbilder.

Anropen mot App Store Connect för butikssidan är skrivna mot Apples dokumentation och enhetstestade
mot en ersättare, men har **inte körts mot Apple**. Textförslaget, skärmbilden i rätt storlek och
ikonen är körda på riktigt; flödet i webbläsaren är kört mot låtsasarbetaren. Räkna med justeringar
första gången en sida skickas, troligast i hur skärmbilderna laddas upp. iPhone-klienten har inte
den här guiden.

### Användarens eget Apple-konto

För att någon utanför ditt team ska kunna publicera sin app behöver appen ligga i **deras eget**
Apple-utvecklarkonto. Apples riktlinje 4.2.6 kräver att appar från en appgenereringstjänst skickas in av
den som står för innehållet, så att samla allas appar under tjänstens konto är inte en väg framåt.

Med `SECRETS_KEY` satt på servern får varje användare en guide ("Apple-konto" bland sina appar, eller
knappen "Till TestFlight" i en app): skaffa konto hos Apple, skapa en API-nyckel i App Store Connect,
ladda upp nyckelfilen. Key ID läses ur filnamnet och Team ID hämtas från Apple när det går. Nyckeln
prövas mot Apple (enbart läsanrop) innan den sparas, krypterad med AES-256-GCM. Därefter går användarens
uppladdningar till deras konto i stället för ditt, och `TESTFLIGHT_USERS` behövs inte för dem.

På arbetaren som ska ladda upp sätts `PUBLISH_FOR_USERS=1`. Användarens nyckel skickas då med jobbet
och finns på disk i en privat temporär mapp bara medan uppladdningen pågår. Eftersom appar i simulatorn
körs som samma macOS-användare bör en publik tjänst ha en egen Mac för uppladdningar, startad med
`PREVIEWS=0` så att den aldrig kör simulatorer.

Det användaren fortfarande gör själv hos Apple: gå med i utvecklarprogrammet och skapa appen i
App Store Connect första gången (Apple har inget API för det). Uppladdningen väntar in det steget, och
kontoägaren läggs sedan till som TestFlight-testare automatiskt.

Kopplingen är provad mot en låtsasversion av Apples API och uppladdningen mot låtsasarbetaren. Med en
riktig nyckel är bara kontrollen av nyckeln och uppladdningen under operatörens konto körda mot Apple.

### Drift

```bash
npm run build && NODE_ENV=production npm start
```

Servern lyssnar på `PORT` (8787) och serverar även den byggda webbklienten. Lägg den bakom en omvänd
proxy med HTTPS som släpper igenom WebSocket (`/ws` och `/worker`), och sätt `TRUST_PROXY=1`. Proxyn ska
skicka vidare `Host` (eller `X-Forwarded-Host`) oförändrad, annars avvisas webbläsarens WebSocket. Databasen
är en SQLite-fil i `data/`; ta backup på den.

#### Fly.io

Repot innehåller `Dockerfile` och `fly.toml` för [Fly.io](https://fly.io): en maskin i Stockholm som aldrig
stängs av (Mac-arbetaren håller en anslutning öppen), med databasen på en volym under `/data`.

```bash
fly launch --copy-config --no-deploy --name ditt-namn --region arn
fly volumes create data --region arn --size 1
grep -E '^(ANTHROPIC_API_KEY|WORKER_TOKEN|INVITE_CODE|SECRETS_KEY|TESTFLIGHT_USERS)=.+' .env | fly secrets import --stage
fly deploy --ha=false
```

Därefter sätts `SERVER_URL=wss://ditt-namn.fly.dev` i `.env` på Macen, och nya versioner driftsätts med
`fly deploy`. `fly launch` skapar även en GitHub-åtgärd för automatisk driftsättning; den kräver en
`FLY_API_TOKEN` i repots hemligheter och är inte incheckad här. Servern pingar sina WebSocket-anslutningar
var 25:e sekund, annars kopplar Flys proxy ner en tyst arbetare efter ungefär en minut.

## iPhone-appen

`ios/` innehåller en första version av Appsmedjan som iPhone-app (SwiftUI, iOS 17+): logga in eller
skapa konto, se och skapa appar, chatta med agenten medan den arbetar, se simulatorns skärm och styra
den med tryck, svep och text, samt skicka appen till TestFlight. Den pratar med samma server som
webbklienten, över samma API och WebSocket.

```bash
cd ios && xcodegen generate && open Appsmedjan.xcodeproj
```

Appen ansluter till `https://appsmedjan.fly.dev`. En utvecklingsbyggnad kan peka på en annan server med
startargumentet `-serverURL http://localhost:8787`. Xcode-projektet och `Info.plist` genereras av
XcodeGen från `ios/project.yml` och är inte incheckade.

Saknas ännu: kodvyn, koppling av eget Apple-konto (görs på webben), engelsk översättning, appikon, och
signering för riktig telefon. Enhetstesterna (`Tests/ProtocolTests.swift`) täcker tolkningen av serverns
meddelanden; flödet konto, ny app, chatt, förhandsvisning och hemknapp är provkört i simulatorn mot en
riktig byggarbetare.

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

Bygge, simulator, bildström, tryck och text samt uppladdning till TestFlight är körda på riktiga Macar,
både en egen och en hyrd (se "Hyrda Macar"). Det här är **inte kört på riktigt**:

- Att skicka appens sida till App Store Connect (se "Appens sida i App Store").
- Uppladdning med en användares eget kopplade Apple-konto.
- `scripts/e2e.mjs` (Playwright är inte installerat här).
- En omstart av den hyrda Macen.

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
