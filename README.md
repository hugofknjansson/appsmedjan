# App Dance

Beskriv en app med egna ord och få en riktig, native iPhone-app (SwiftUI) byggd åt dig. Appen körs i en
iOS-simulator som strömmas till webbläsaren, så användaren behöver varken Mac, Xcode eller någon
installation.

Tjänsten hette tidigare Appsmedjan. Det namnet lever kvar i tekniska namn som inga användare ser och som
körande system hänger på: adressen `appsmedjan.fly.dev`, kodförrådet, bundle-id-prefixet `app.appsmedjan`,
databasfilen, launchd-etiketterna `se.appsmedjan.*` och arbetarnas loggfiler. Namnet som visas står i
`web/src/Logo.tsx`, `web/index.html`, `server/src/prompt.ts`, `shared/appstore.ts` och `ios/project.yml`.

Tjänsten är gjord för den som aldrig har byggt programvara. Därför syns ingen kod någonstans: det
finns ingen kodvy, chatten visar bara vad byggaren säger (inte stegen den tar), och byggaren är
instruerad att svara med ett par korta meningar utan tekniska ord. All väntan har något att titta
på: maskoten dansar sig igenom sving, hopp och piruett, texterna under den byter av varandra, och
det blir konfetti när byggaren är klar och när appen har kommit fram till telefonen.

Medan byggaren arbetar visar chatten en ruta med ledtrådar: vad som görs just nu i vanliga ord
("Bygger appen", "Provkör appen", "Rättar en detalj"), en stapel som växer, hur många delar som är
klara och en klocka. Stegen räknas fram ur byggarens verktygsanrop (`runProgress` i
`shared/protocol.ts`), men själva anropen visas aldrig. Efter väntan kommer en enda sak: byggarens
första mening och frågan om man vill installera appen på telefonen och testa.

Varje app får en ikon. Byggaren ritar den som en liten SVG med verktyget `set_app_icon` när appen
skapas, och servern gör om teckningen till en PNG på 1024 px (`server/src/iconart.ts`). Bara enkla
former släpps igenom: ingen text, inga bilder utifrån, inga skript, och bakgrunden måste fylla hela
kvadraten. En app som byggaren inte hann rita åt får en enkel ikon i en egen färg, och en ikon som
personen själv har valt i App Store-guiden skrivs aldrig över.

## Konton

Ett konto är en e-postadress och ett lösenord. Runt det finns:

- **Bekräftelse av e-post.** När kontot skapas skickas ett mejl med en länk (`/api/auth/verify/…`, gäller
  i sju dagar). Tills den är öppnad ber webben om den och erbjuder att skicka mejlet igen, högst en
  gång i minuten. Med `REQUIRE_VERIFIED_EMAIL=1` byggs inget innan adressen är bekräftad
  (`email_unverified`), vilket hindrar att någon skapar konto efter konto för gratis credits. Utan den
  skickas och efterfrågas mejlet, men inget väntar på det.
- **Glömt lösenord.** Personen skriver sin adress och får en länk (`/reset/…`, gäller en timme och en
  gång) där ett nytt lösenord väljs. Svaret är detsamma oavsett om adressen har ett konto, så att ingen
  kan ta reda på vilka adresser som finns. Ett nytt lösenord loggar ut kontot överallt, loggar in
  personen där och räknar adressen som bekräftad.
- **Radera kontot**, under Mitt konto i både webben och iPhone-appen (Apple kräver det i appen).
  Lösenordet efterfrågas igen. Appar, chattar, telefoner, plan, credits och en kopplad Apple-nyckel
  försvinner, och simulatorerna och appfilerna för telefonen städas bort. Telefoner som har registrerats
  i ett utvecklarkonto står kvar där tills medlemsåret förnyas, eftersom Apple inte låter dem tas bort
  tidigare.

Mejlen skickas genom Resend: `MAIL_API_KEY` och `MAIL_FROM`, en avsändare på en domän som är verifierad
hos Resend (`App Dance <hej@din-domän.se>`). Utan dem skickas inga mejl: glömt lösenord svarar då att
tjänsten inte kan skicka mejl, och bekräftelsen efterfrågas inte. På en utvecklingsdator skrivs mejlen
i serverns logg i stället, med länk, så att flödena går att prova.

## Planer

Vad en person får göra kan styras av en plan. Det finns tre, och de står i `shared/protocol.ts`
(`PLANS`), så att servern och klienterna alltid visar samma tal:

| Plan | Appar | Meddelanden per månad | Appen på telefonen | App Store-guiden |
|---|---|---|---|---|
| Prova (`free`) | 1 | 20 | ja | nej |
| Skapa (`create`) | 10 | 300 | ja | nej |
| Publicera (`publish`) | 50 | 600 | ja | ja |

Gränserna följer det som kostar: meddelanden till byggaren är modellens arbete, och en telefon tar
en plats i utvecklarkontot. Alla planer får prova appen på sin egen telefon; `FREE_INSTALL=0` tar bort
telefonen ur Prova, så att den bara provar i simulatorn. De som driver tjänsten (`OPERATOR_EMAILS`) räknas inte.

Utan betalning (se "Betalning" nedan) ber en person om en större plan under "Min plan", eller från
frågan om att installera på telefonen, och den som driver tjänsten ser förfrågan längst ned på sin
startsida på webben och delar ut planen där. Med betalning köper personen planen själv.

Planerna gäller först med `PAYWALL=1` på servern. Utan den är allt öppet för alla som förut, men
planer kan redan delas ut. `DEFAULT_PLAN` är planen för den som inte har fått någon (`free` om inget
anges). En begäran som en plan inte täcker besvaras med 402 och namnet på den plan som räcker.

### Credits

Med `CREDITS=1` (utöver `PAYWALL=1`) räknar planerna credits i stället för meddelanden. Ett meddelande
kostar då det som arbetet bakom det kostade: alla tokens byggaren läste och skrev, till modellens
listpris (`MODEL_RATES` i `shared/protocol.ts`), så en liten ändring kostar lite och en ny app mer.
Utan `CREDITS=1` räknas meddelanden precis som förut.

| Plan | Credits |
|---|---|
| Prova | 25, en gång |
| Skapa | 100 i månaden |
| Publicera | 260 i månaden |

- **En credit** är 0,10 dollar av modellens arbete (`CREDIT_DOLLARS`). Fyra uppmätta körningar med
  Opus 5.5 och effort `high` (november 2026): en ny app 5 credits (0,46 och 0,50 dollar), en liten
  ändring 1 credit (0,09 dollar) och en stor ändring med flera byggen 7 credits (0,67 dollar).
- **Taket** för ett meddelande är 40 credits (`MAX_CREDITS_PER_MESSAGE`); det som går över bjuder
  tjänsten på. Ett meddelande drar heller aldrig saldot under noll: den som har några credits kvar
  får skicka ett meddelande till, och betalar bara det som finns kvar.
- **Avdraget** görs när byggaren är klar (`[usage]`-raden visar kostnaden i dollar, credits och vad som
  drogs). En körning som personen stoppar dras; en som tjänsten inte klarade (överbelastning, fel)
  sparas men dras inte. App Store-texterna som byggaren föreslår dras på samma sätt.
- **Månadens credits** delas ut första gången personen använder tjänsten den månaden och gäller till
  slutet av nästa månad. Den som får en större plan mitt i en månad får skillnaden direkt. Credits
  som delas ut utanför planen gäller ett år. Det som går ut först används först.
- **Andra tal** för planerna ges med `PLAN_CREDITS`, till exempel `free=10; create=120; publish=300`.
- **De som driver tjänsten** dras aldrig, kan ge vem som helst credits från sin startsida på webben
  (`POST /api/operator/credits`), och ser vad varje person har kostat i dollar den här månaden. Det
  syns även när credits är avstängda, eftersom varje körning sparas med sin kostnad.

Enstaka påfyllningar av credits går inte att köpa än; de delas ut av den som driver tjänsten
(`give` i `server/src/credits.ts`).

### Betalning

Med Stripe köper en person sin plan själv, som en prenumeration per månad. Koden finns i
`server/src/pay.ts` och använder Stripes API direkt, utan något paket.

- **Köpet** görs på Stripes egen sida (Checkout). "Välj Skapa" under "Min plan" skickar personen
  dit och Stripe skickar tillbaka dem. Kortuppgifter når aldrig den här servern.
- **Planen** slås på när Stripe meddelar servern (`POST /api/pay/webhook`). Servern litar inte på
  vad meddelandet innehåller utöver vilken prenumeration det gäller: den frågar Stripe hur
  prenumerationen ser ut nu och rättar sig efter det. Meddelanden som kommer sent, dubbelt eller i
  fel ordning gör därför ingen skada. Signaturen kontrolleras, och ett meddelande som är äldre än
  fem minuter släpps inte in.
- **Byta plan, byta kort och säga upp** görs på Stripes kundportal ("Hantera betalning"). En
  uppsagd plan gäller perioden ut. När prenumerationen är slut har personen gratisplanen igen, och
  de credits som finns kvar ligger kvar tills de går ut.
- **Credits** för en betald plan ges en gång per betald period och gäller en period till, inte per
  kalendermånad: annars skulle den som betalar sista dagen i en månad få två månaders credits för
  en betalning. En betalning som inte går igenom ger inga nya credits förrän den har gått igenom,
  men planen ligger kvar så länge Stripe försöker igen.
- **Radera konto** säger först upp prenumerationen hos Stripe. Går inte det raderas inte kontot,
  så att ingen fortsätter betala för ett konto som är borta.
- **Återbetalningar** görs i Stripe. Credits tas inte tillbaka av sig själva.
- **iPhone-appen** säljer inga planer. Köp inne i en app måste gå genom Apple, som tar 15–30 %.

Så slås det på:

1. Skapa två produkter i Stripe med var sitt pris per månad (till exempel 249 kr och 499 kr, moms
   inräknad).
2. Lägg till en webhook till `https://din-adress/api/pay/webhook` med händelserna
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid` och `invoice.payment_failed`.
3. Slå på kundportalen i Stripe och låt kunder säga upp, byta kort och byta mellan de två priserna.
4. Sätt nyckeln, webhookens hemlighet och priserna:

```bash
fly secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_PRICES="create=price_...; publish=price_..."
```

Utan alla tre visas inga köpknappar och allt fungerar som förut. `STRIPE_TAX_RATE=txr_...` lägger en
momssats från Stripe på varje prenumeration, så att kvittona visar momsen. `PLAN_PRICES` är texten
som visas bredvid planerna och ska stämma med priserna i Stripe. Prova först med Stripes testnycklar
(`sk_test_...`) och ett testkort.

## Så hänger det ihop

```
 Webbläsare                    Server (Linux går bra)                  Mac med Xcode
┌──────────────────┐  HTTPS   ┌───────────────────────────┐   WSS    ┌──────────────────────────┐
│ Chatt            │ ───────► │ Konton, projekt, filer    │ ◄─────── │ Byggarbetare (worker/)   │
│ Telefon-         │ ◄─────── │ (SQLite)                  │  jobb,   │  XcodeGen + xcodebuild   │
│ förhandsvisning  │  WSS     │ AI-agent (Claude API)     │  bilder, │  iOS-simulator per app   │
│                  │          │ Kö och relä till arbetare │  tryck   │  skärmström + inmatning  │
└──────────────────┘          └───────────────────────────┘          └──────────────────────────┘
```

- **`web/`** React-klient: inloggning, projektlista, chatt, telefonförhandsvisning och installation på egen telefon. Svenska och engelska.
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

#### Så startar simulatorn snabbt

En helt ny simulator lägger nästan en minut på sin första start, och den första installationen efter
varje start tar ytterligare 6–14 sekunder. Medan det pågår drar iOS egna bakgrundstjänster (Siri,
Apple Intelligence, Hälsa med flera) så mycket kraft att allt annat på Macen går trögt. Arbetaren
gör därför detta:

- **En mall per telefonmodell** (`asm-template-…`). Den görs en gång, i bakgrunden när arbetaren
  startar: den startas, installerar och startar en liten app, tar bort den och startas en gång till.
  Varje ny app får en kopia av mallen, och en kopia startar på några sekunder. `SIM_TEMPLATE=0` gör
  nya simulatorer från början som förut.
- **En färdigstartad reserv** (`asm-spare-…`), när det finns plats bredvid apparna som är öppna. En
  ny app tar över den direkt utan någon start alls. Det gör också den som kommer tillbaka till en app
  vars simulator har stängts av; det appen har sparat flyttas då över, och den gamla simulatorn tas
  bort. Reserven viker för en app som behöver platsen, och nästa reserv startas först när ingen app har
  byggts på 45 sekunder, eftersom en simulator som startar gör byggen långsammare. `SIM_SPARE=0`
  stänger av den.
- **Uppvärmning** efter varje start: en liten app installeras och tas bort medan användarens kod
  kompileras, så att användarens installation blir den snabba andra. `SIM_PRIME=0` stänger av den.
- **Bildströmmen startar när simulatorn är uppe**, inte när appen har startat, så att den redan är
  igång när appen visas. `SIM_EARLY_STREAM=0` stänger av det.

Varje bygge skriver en rad `[timing]` i arbetarens logg med när varje steg var klart: filer,
kompilering, start, installation, uppstart och första bilden till tittaren. Mätt på en Mac med många
simulatorer igång tog en ny app 79 sekunder till första bilden före och omkring 9 sekunder efter, en
ändring omkring 2 sekunder, och att komma tillbaka till en avstängd app omkring 8 sekunder. Utan reserv,
till exempel när två nya appar kommer tätt efter varandra, tar en ny app längre tid, eftersom
kopian ska starta och värmas upp först.

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
5. Kontoägaren läggs automatiskt till som intern TestFlight-testare, i en grupp som heter "App Dance"
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

### Appen på telefonen

Knappen **På min telefon** i ett projekt ger två sätt att prova appen på en riktig iPhone:

- **Direkt.** En QR-kod som öppnar projektet i telefonens webbläsare, redan inloggad. Appen strömmas
  från simulatorn och går att trycka och skriva i, men den är inte installerad. Koden är en
  engångsbiljett som gäller i fem minuter.
- **Installerad.** En publik TestFlight-länk. Den som öppnar länken behöver bara Apples gratisapp
  TestFlight: inget utvecklarkonto och ingen inbjudan. Efter varje uppladdning fyller arbetaren i
  testinformationen, lägger bygget i en extern testgrupp med publik länk och skickar det till Apples
  betagranskning. Servern frågar sedan Apple hur det går (varje minut medan bygget bearbetas, var
  femte minut under granskningen) och visar en QR-kod när länken fungerar. Apple granskar första
  bygget av varje app; hur lång tid det tar varierar.

Vem som behöver vänta på Apples granskning:

| Vem | Väg | Väntan |
|---|---|---|
| Den som driver tjänsten, i sitt eget konto | Intern testare, läggs till automatiskt | Några minuter |
| Person med eget kopplat utvecklarkonto | Intern testare i sitt eget konto | Några minuter |
| Person utan konto, via tjänstens konto | Publik länk | Apples betagranskning av första bygget |

För den sista gruppen finns ett snabbspår, om `INTERNAL_TESTERS=1` är satt: personen bjuds in till
tjänstens utvecklarteam som intern testare av sin egen app (rollen Developer, bara den appen, utan
tillgång till certifikat). De tackar ja i ett mejl från Apple, servern märker när de har gjort det
och lägger dem i appens interna testgrupp, och sedan kommer varje bygge till deras TestFlight på
några minuter. Ett team rymmer 100 interna testare, och de blir medlemmar i ditt App Store
Connect-team, så det är avstängt tills du slår på det.

Tre inställningar på servern hör till detta:

- `OPERATOR_EMAILS`: de som driver tjänsten. Apple har inget API för att skapa en app i App Store
  Connect, så för uppladdningar till ditt eget konto måste du skapa appen för hand. De här
  användarna ser på sin startsida vilka appar som väntar, med namn och bundle-id.
- `INTERNAL_TESTERS=1`: slår på snabbspåret ovan.
- `BETA_CONTACT`: vem Apple får kontakta om appar som testas från ditt konto. Utan den frågas varje
  person efter egna kontaktuppgifter innan länken skapas.

Anropen för testlänken är skrivna mot Apples dokumentation och enhetstestade mot en ersättare, och
flödet är kört i webbläsaren mot låtsasarbetaren, men de har **inte körts mot Apple**.

### Direkt på telefonen, utan TestFlight

Det snabbaste sättet för en person att få sin app på sin egen telefon. Apple låter ett utvecklarkonto
installera appar direkt på telefoner som är registrerade i kontot (ad hoc-distribution): ingen
granskning, ingen TestFlight-app och ingen app i App Store Connect, så du behöver inte skapa något
för hand.

1. **Lägg till telefonen, en gång.** Personen öppnar en länk på telefonen (en QR-kod i webben, eller
   knappen i iPhone-appen) och installerar en liten profil i Inställningar. Telefonen skickar då sitt
   id (UDID) till servern. Profilen blir inte kvar på telefonen.
2. **Bygg.** Signeringsarbetaren registrerar telefonen i utvecklarkontot om den inte redan finns där,
   bygger appen, signerar den för kontots registrerade telefoner och lämnar appfilen till servern.
   Det tar under en minut för en liten app.
3. **Installera.** Telefonen öppnar en sida med en installationsknapp. iOS frågar, och appen hamnar på
   hemskärmen. Första gången måste personen slå på Utvecklarläge under Inställningar, Integritet och
   säkerhet; det kräver Apple för appar som inte kommer från App Store eller TestFlight.

När personen har lagt till en telefon är den platsen där appen provas. I iPhone-appen heter
mittfliken då "Min telefon", och i webben finns en egen flik bredvid simulatorn. Servern bygger en
ny version för telefonen av sig själv varje gång byggaren är klar med en ändring och appen går att
bygga, så att den ligger och väntar. Vägen visas som fyra steg med en stapel: bygger, signerar,
hämtas till telefonen, installeras på hemskärmen. De två första kommer från arbetaren. Det tredje
ser servern själv, när telefonen ber om listan och sedan hämtar appfilen. Vad iOS gör därefter går
inte att se utifrån; det tar några sekunder.

Läggs telefonen till från en app går det fortare (`QUICK_INSTALL`, påslaget om inget anges). Koden att
skanna visas direkt när personen svarar ja på frågan om telefonen, och biljetten i den säger vilken app
det gäller. När telefonen är tillagd byggs appen för den av sig själv, och sidan telefonen hamnar på
efter profilen väntar på bygget (den laddar om sig själv) och blir sedan installationssidan. Personen
behöver alltså varken gå tillbaka till datorn, trycka på Bygg eller skanna en andra kod. Bara ett bygge
som har startat efter att telefonen lades till räknas, eftersom ett äldre inte är signerat för den.
`QUICK_INSTALL=0` skickar tillbaka telefonen till App Dance som förut.

**Skicka till telefonen från webben.** Har personen lagt till sin telefon skickar ett klick på fliken
"Min telefon" (eller på installationsknappen efter ett bygge) appen till telefonen
(`POST /api/projects/:id/to-phone`). iOS installerar aldrig något utan att telefonens ägare säger ja på
telefonen, så ett tryck finns alltid kvar, men inget mer:

- **När App Dance är öppen på telefonen** har appen en egen förbindelse till servern (`/ws/me`), och
  iOS fråga om installation visas direkt.
- **När App Dance är stängd** skickas en notis via Apples push-tjänst. Ett tryck på den öppnar frågan.
  Appen ber om lov att skicka notiser första gången personen lägger till telefonen eller trycker
  Installera i appen.
- **När bygget inte är aktuellt** startar ett nytt, och appen skickas till telefonen när det är klart.

Notiserna kräver en APNs-nyckel från utvecklarkontot (Certificates, Identifiers & Profiles > Keys >
Apple Push Notifications service). Det är inte samma nyckel som App Store Connect-nyckeln:

```bash
fly secrets set APNS_KEY="$(cat ~/Downloads/AuthKey_XXXXXXXXXX.p8)" APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=XXXXXXXXXX -a appsmedjan
```

Utan nyckeln fungerar allt utom notisen. Är appen stängd skannar personen då koden som förut.
Notisens adress följer telefonen: den som loggar in sist på en telefon får dess notiser, och den
glöms när personen loggar ut eller Apple säger att appen är borta.

Simulatorn finns kvar. Byggaren använder den för att kompilera, rätta fel och titta på skärmen, App
Store-bilderna tas därifrån, och den är vad den som inte har lagt till en telefon ser.

Det som begränsar:

- Ett konto får registrera **100 iPhones per medlemsår**, och en plats frigörs först vid förnyelsen.
- Apple menar ad hoc för test på telefoner hos dem du arbetar med. För den som bygger sin egen app
  ligger det nära, men det är inte en kanal för att sprida appar brett. Därför är det avstängt för
  tjänstens eget konto tills du slår på det. Den som har kopplat ett eget utvecklarkonto kan alltid
  använda det: platserna är deras egna.
- Appen fungerar så länge signeringen gäller, högst ett år, och får sedan byggas om.
- Profilen i appfilen räknar upp alla telefoner som är registrerade i kontot, inte bara personens
  egna. Appfilen nås bara med en hemlig länk, men den som har filen kan läsa de andra telefonernas id.
- I ett nytt utvecklarkonto släpper Apple in de tio första telefonerna direkt; därefter kan en ny
  telefon ta 1–3 dygn. Bygget säger då att telefonen inte är klar än.

Inställningar på servern:

- `DIRECT_INSTALL=1`: låter alla som är inloggade prova sina appar på sin egen telefon via tjänstens
  konto, oavsett `TESTFLIGHT_USERS`. Det är vad tjänstens konto lånas ut till. Att dela appen via
  TestFlight eller lägga upp den i App Store kräver ett eget kopplat utvecklarkonto, om personen inte
  står i `TESTFLIGHT_USERS`. Alla delar på kontots 100 telefonplatser per år.
- `MAX_PHONES_PER_USER`: hur många telefoner en person får lägga till (2 om inget anges).
- `PUBLIC_URL`: adressen telefoner når tjänsten på, om den inte går att läsa ut ur anropet.
  Installationen kräver https med ett giltigt certifikat.

Signeringen för registrerade telefoner **är körd mot Apple** från en utvecklingsdator: appfilen
byggdes, profilen innehöll telefonen och telefonen tog emot appen. Det som **inte är provat på en
riktig telefon** är profilen som lämnar telefonens id och installationen via länken; de är byggda
efter Apples dokumentation och körda mot låtsasarbetaren. Låtsasarbetaren känner igen
`MOCK_PHONE_PROCESSING` och `MOCK_PHONE_LIMIT` i källkoden för att prova felen.

### Appens sida i App Store

Knappen **App Store** i ett projekt öppnar en guide som förbereder det som syns i butiken och skickar
det till App Store Connect, till samma konto som TestFlight-uppladdningarna går till:

- **Texter**: namn, underrubrik, kampanjtext, beskrivning, sökord, kategori och länkar, med Apples
  teckengränser. "Föreslå texter från appen" låter Claude skriva ett förslag utifrån appens kod, på
  appens eget språk. Förslaget sparas inte förrän personen har läst det och tryckt Spara.
- **Supportsida och integritetspolicy**: Apple kräver båda, på webben. Den som saknar egen webbplats
  kan låta tjänsten visa dem på `/a/<projekt-id>/support` och `/a/<projekt-id>/privacy`. Sidorna är
  öppna för alla, finns bara för projekt där ägaren har slagit på dem, och visar bara det ägaren
  skrivit: appens namn, en e-postadress för support, policytexten och (om kontaktuppgifterna är
  ifyllda) vem som ansvarar för appen. Textförslaget skriver också ett utkast till policyn utifrån
  koden. Den som har egna sidor anger sina adresser i stället.
- **Skärmbilder**: knappen "App Store-bild" under förhandsvisningen sparar det som visas just då.
  Bilden tas i simulatorn och skalas till storleken Apple kräver för den största iPhonen
  (1320 × 2868), så ingen större simulator behöver köras. Högst tio.
- **Ikon**: en egen PNG på 1024 × 1024 används från nästa TestFlight-uppladdning. Genomskinlighet
  fylls med vitt, eftersom Apple inte godkänner den.
- **Uppgifter till Apple**: tre påståenden som personen kryssar i om de stämmer, och kontaktuppgifter
  för granskningen. "Inget av det Apple frågar om för åldersgränsen" besvarar alla åldersfrågor med
  nej (4+). "Inget material från andra" sätter rättighetsdeklarationen. "Gratis i alla länder" sätter
  pris och tillgänglighet, men bara om appen inte redan har det. Det som inte kryssas i rörs inte.
  Textförslaget säger också om det hittade något i koden som höjer åldersgränsen. Kontaktuppgifterna
  sparas per person och används för alla deras appar.
- **Skicka**: arbetaren som har kontots nyckel fyller i versionens texter på appens primära språk,
  byter ut skärmbilderna, sätter kategorin, väljer det senast uppladdade bygget och fyller i
  uppgifterna ovan samt upphovsrättsraden.
- **Skicka in för granskning**: en egen knapp, som går att trycka på när sidan är skickad med ett
  bygge valt och inget har ändrats sedan dess. Personen får en fråga innan. Tjänsten skickar aldrig
  in något på eget initiativ.

Två saker finns kvar i App Store Connect, eftersom Apple inte har något API för dem:
integritetsfrågorna (vilka uppgifter appen samlar in) och, för appar i kategorierna hälsa och medicin,
deklarationen om appen är en medicinteknisk produkt. Saknas något säger Apple det när appen skickas
in, och det svaret visas i guiden tillsammans med vad man gör åt det.

Begränsningar i den här versionen: bara appens primära språk, bara en första version (en app som
redan är släppt eller granskas lämnas orörd), bara iPhone-skärmbilder, och bara gratisappar.

Mot Apple är hela kedjan körd med en riktig app i tjänstens eget konto: sidan skickades (texter,
skärmbild, kategori och val av bygge gick igenom på första försöket), Apple avvisade inskicket två
gånger med besked om vad som saknades, och efter att rättighetsdeklarationen skickats härifrån och
medicinteknikfrågan besvarats i App Store Connect togs appen emot för granskning. Det visar att
rättigheter och kontaktuppgifter når Apple. Om åldersgräns, pris och tillgänglighet sattes härifrån
eller för hand i de körningarna framgår inte av loggen, så räkna med justeringar där. Textförslaget
(med policyutkastet), skärmbilden i rätt storlek, ikonen och de publika sidorna är också körda på
riktigt. iPhone-klienten har inte den här guiden.

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

`ios/` är en SwiftUI-klient för samma server, med samma flöden som webbklienten:

- logga in eller skapa konto, se och skapa appar
- chatta med agenten och följa stegen medan den arbetar
- se simulatorns skärm, trycka, svepa och skriva i den, och spara skärmbilder till App Store
- göra appen installerbar via en publik TestFlight-länk, och öppna länken direkt
- App Store-guiden: texter med förslag från Claude, supportsida och integritetspolicy, skärmbilder,
  ikon (valfri bild görs om till rätt format), uppgifter till Apple, skicka sidan och skicka in
- koppla ett eget Apple-utvecklarkonto, med nyckelfilen vald från Filer
- för den som driver tjänsten: listan över appar att skapa i App Store Connect

Appen är på svenska och engelska (`Sources/Localizable.xcstrings`). Ikonen, en dansande app-ruta, ritas av
`scripts/ios-icon.swift`.
Samma figur är appens maskot: `Sources/Mascot.swift` ritar den och låter den dansa när något arbetar, och
`Sources/Look.swift` har färgerna, knapparna och de andra delarna som ger appen dess utseende.

Bygg och kör i simulatorn (kräver Xcode 26 eller senare och XcodeGen):

```bash
cd ios && xcodegen generate && open AppDance.xcodeproj
```

Appen pratar med `https://appsmedjan.fly.dev`. En utvecklingsbygge kan pekas mot en annan server med
startargumentet `-serverURL http://localhost:8787`, och startas inloggad med `-sessionCookie <värdet
av serverns sid-kaka>` (finns bara i Debug).

För en riktig telefon eller TestFlight behövs ditt team: `APPLE_TEAM_ID=XXXXXXXXXX xcodegen generate`,
och sedan arkivering i Xcode. Bundle-id:t är `app.appsmedjan.ios`.

Kört i simulatorn mot en teststack med låtsasarbetare: inloggad start, installationsflödet fram till
"Öppna i TestFlight", App Store-guidens formulär och engelska. **Inte kört**: appen på en
riktig telefon, koppling av Apple-konto, ikonval från bildbiblioteket, skärmbildsknappen och att
skicka sidan från appen. Tio enhetstester täcker tolkningen av serverns meddelanden.

## Tester

```bash
npm test
```

```bash
npm run build && npm run test:e2e
```

`test:e2e` startar servern, låtsasarbetaren och en skriptad ersättare för Claude-API:t, och kör hela
flödet i en riktig webbläsare: konto, ny app, agentens skriv-bygg-rätta-loop, bildström, tryck och text,
att ingen kod syns, och åtkomstkontroll mellan konton. Det kräver att Playwright finns installerat (`npm i -g playwright`
eller motsvarande).

### Vad som inte är testat

Bygge, simulator, bildström, tryck och text samt uppladdning till TestFlight är körda på riktiga Macar,
både en egen och en hyrd (se "Hyrda Macar"). Det här är **inte kört på riktigt**:

- Den publika TestFlight-länken (testgrupp, testinformation, betagranskning) och inbjudan av interna
  testare (se "Appen på telefonen").
- Delar av uppgifterna som skickas med appens sida: åldersgräns, pris och tillgänglighet (se "Appens
  sida i App Store").
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
- QR-koden för att öppna ett projekt på telefonen innehåller en inloggningsbiljett. Den fungerar en
  gång och i fem minuter, och den som skannar den blir inloggad som kontots ägare. Den visas bara
  för den som redan är inloggad.
- De publika sidorna under `/a/` kräver ingen inloggning. De byggs som ren HTML av servern, all text
  från användaren kodas om, och svaret tillåter varken skript eller inbäddat innehåll. Det som visas
  (namn och e-postadress) är det ägaren själv valt att göra offentligt.
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
