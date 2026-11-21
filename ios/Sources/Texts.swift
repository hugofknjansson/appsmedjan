// Turns the server's codes into sentences for people. The same wording as the web client.
import Foundation

enum Texts {
  /// For error codes from the REST API.
  static func apiError(_ code: String) -> String {
    switch code {
    case "network": String(localized: "Det gick inte att nå servern. Kontrollera din uppkoppling.")
    case "wrong_login": String(localized: "Fel e-post eller lösenord.")
    case "email_taken": String(localized: "Det finns redan ett konto med den e-postadressen.")
    case "invalid_credentials_format": String(localized: "Ange en giltig e-postadress och ett lösenord på minst 8 tecken.")
    case "bad_invite": String(localized: "Inbjudningskoden stämmer inte.")
    case "direct_not_offered": String(localized: "Installation direkt på telefonen är inte påslagen för ditt konto.")
    case "no_phones": String(localized: "Lägg till din telefon först.")
    case "too_many_attempts": String(localized: "För många försök. Vänta en stund och försök igen.")
    case "daily_limit": String(localized: "Du har nått dagens gräns för meddelanden. Välkommen tillbaka i morgon.")
    case "project_limit": String(localized: "Du har nått gränsen för antal appar. Ta bort en app för att skapa en ny.")
    case "plan_apps": String(localized: "Din plan rymmer inte fler appar. Ta bort en app, eller be om en större plan under Min plan.")
    case "plan_messages": String(localized: "Månadens meddelanden är slut i din plan. Be om en större plan under Min plan.")
    case "plan_install": String(localized: "Appen på telefonen ingår i planen Skapa. Du ber om den under Min plan.")
    case "plan_store": String(localized: "App Store-guiden ingår i planen Publicera. Du ber om den under Min plan.")
    case "bad_plan": String(localized: "Det gick inte att be om den planen.")
    case "bad_prompt": String(localized: "Skriv vad du vill bygga (högst 8000 tecken).")
    case "busy": String(localized: "Vänta tills det pågående arbetet är klart.")
    case "publish_forbidden": String(localized: "Ditt konto får inte skicka appar till TestFlight.")
    case "publish_unavailable": String(localized: "TestFlight är inte tillgängligt just nu.")
    case "bad_listing": String(localized: "Texterna gick inte att spara. Kontrollera att inget fält är orimligt långt.")
    case "screenshot_no_preview": String(localized: "Starta förhandsvisningen först: bilden tas av det som visas i telefonen.")
    case "screenshot_full": String(localized: "Du har redan så många skärmbilder som App Store tillåter. Ta bort en först.")
    case "screenshot_failed": String(localized: "Det gick inte att ta bilden. Försök igen.")
    case "icon_not_png", "icon_wrong_size": String(localized: "Ikonen gick inte att använda. Välj en annan bild.")
    case "store_forbidden": String(localized: "Koppla ditt Apple-utvecklarkonto för att kunna skicka sidan.")
    case "store_unavailable": String(localized: "Ingen byggserver som kan nå Apple är ansluten just nu.")
    case "store_incomplete": String(localized: "Allt är inte ifyllt än.")
    case "store_not_ready": String(localized: "Skicka först sidan till App Store Connect med ett bygge valt, och fyll i kontaktuppgifterna.")
    case "bad_contact": String(localized: "Kontaktuppgifterna gick inte att spara.")
    case "not_uploaded": String(localized: "Appen är inte uppladdad än.")
    case "fast_unavailable": String(localized: "Det går inte att bjuda in testare just nu.")
    case "no_api_key": String(localized: "Tjänsten är inte färdiginställd ännu (API-nyckel saknas).")
    case "rate_limited": String(localized: "Det är många som bygger just nu. Vänta en liten stund och försök igen.")
    case "overloaded": String(localized: "AI-tjänsten svarar inte just nu. Försök igen om en stund.")
    case "refused": String(localized: "Det gick inte att skriva ett förslag för den här appen.")
    case "too_long": String(localized: "Appen är för stor för att skriva ett förslag i ett steg.")
    case "apple_disabled": String(localized: "Koppling av egna Apple-konton är inte påslagen här.")
    case "apple_bad_input": String(localized: "Key ID eller Issuer ID har fel format. Kopiera dem precis som de står i App Store Connect.")
    case "apple_key_invalid": String(localized: "Filen är inte en giltig nyckel från App Store Connect.")
    case "apple_key_rejected": String(localized: "Apple godkände inte nyckeln. Kontrollera att Key ID och Issuer ID hör till just den här filen.")
    case "apple_key_forbidden": String(localized: "Nyckeln fungerar men saknar behörighet. Skapa en nyckel med rollen Admin.")
    case "apple_team_needed": String(localized: "Apple visade inte vilket team kontot har. Fyll i ditt Team ID.")
    case "apple_unreachable": String(localized: "Det gick inte att nå Apple just nu. Försök igen om en stund.")
    default: String(localized: "Något gick fel. Försök igen.")
    }
  }

  /// For error parts inside the agent's answer.
  static func agentError(_ code: String) -> String {
    switch code {
    case "no_api_key": String(localized: "Tjänsten är inte färdiginställd ännu (API-nyckel saknas). Kontakta den som driver tjänsten.")
    case "rate_limited": String(localized: "Det är många som bygger just nu. Vänta en liten stund och försök igen.")
    case "overloaded": String(localized: "AI-tjänsten svarar inte just nu. Försök igen om en stund.")
    case "refused": String(localized: "Det här kan jag tyvärr inte hjälpa till med. Prova att beskriva det på ett annat sätt.")
    case "stopped": String(localized: "Stoppat.")
    case "too_long": String(localized: "Det här blev för stort för ett enda steg. Be om en mindre del i taget.")
    default: String(localized: "Något gick fel hos oss. Försök igen.")
    }
  }

  static func buildStage(_ stage: String?) -> String {
    switch stage {
    case "queued": String(localized: "Väntar på en ledig simulator")
    case "preparing": String(localized: "Förbereder")
    case "compiling": String(localized: "Bygger appen")
    case "installing": String(localized: "Installerar")
    case "launching": String(localized: "Startar appen")
    default: String(localized: "Startar simulatorn")
    }
  }

  /// What the builder is doing right now, in words that say nothing about how an app is made.
  static func runPhase(_ phase: RunProgress.Phase) -> String {
    switch phase {
    case .thinking: String(localized: "Tänker ut din app")
    case .making: String(localized: "Bygger appen")
    case .drawing: String(localized: "Ritar ikonen")
    case .trying: String(localized: "Provkör appen")
    case .fixing: String(localized: "Rättar en detalj")
    case .looking: String(localized: "Tittar hur det blev")
    }
  }

  static func planName(_ id: String) -> String {
    switch id {
    case "create": String(localized: "Skapa")
    case "publish": String(localized: "Publicera")
    default: String(localized: "Prova")
    }
  }

  /// What a plan holds, as lines to read.
  static func planLines(_ limits: PlanLimits) -> [String] {
    var lines = [
      limits.apps == 1 ? String(localized: "1 app") : String(localized: "\(limits.apps) appar"),
      String(localized: "\(limits.messages) meddelanden till byggaren i månaden"),
    ]
    if limits.install { lines.append(String(localized: "Appen på din egen telefon")) }
    if limits.store { lines.append(String(localized: "Hjälp att lägga upp appen i App Store")) }
    return lines
  }

  static func directStage(_ stage: String?) -> String {
    switch stage {
    case "preparing": String(localized: "Förbereder")
    case "archiving": String(localized: "Bygger appen")
    case "signing": String(localized: "Signerar för din telefon")
    default: String(localized: "Väntar på tur")
    }
  }

  static func directError(_ code: String?) -> String {
    switch code {
    case "no_phones": String(localized: "Lägg till din telefon först.")
    case "phone_processing": String(localized: "Apple har tagit emot telefonen men släpper inte in den i appar än. Det kan ta upp till tre dygn i ett nytt konto. Försök igen senare.")
    case "phone_limit": String(localized: "Utvecklarkontot har inte plats för fler telefoner i år. Hör av dig till den som driver tjänsten.")
    case "compile": String(localized: "Appen gick inte att bygga. Be om en rättning i chatten och försök igen.")
    case "signing": String(localized: "Signeringen misslyckades. Den som driver tjänsten har fått veta varför.")
    case "auth": String(localized: "Apple godkände inte nyckeln till utvecklarkontot.")
    case "unavailable": String(localized: "Ingen byggserver som kan signera är ansluten just nu.")
    default: String(localized: "Det gick inte att bygga appen för telefonen. Försök igen om en stund.")
    }
  }

  static func publishStage(_ stage: String?) -> String {
    switch stage {
    case "preparing": String(localized: "Förbereder")
    case "waiting_for_app": String(localized: "Väntar på appen")
    case "archiving": String(localized: "Bygger för iPhone")
    case "uploading": String(localized: "Laddar upp till Apple")
    default: String(localized: "Väntar på tur")
    }
  }

  /// What to tell the person about the latest upload, or nil when there is nothing to say.
  static func publishNote(_ publish: PublishState) -> (text: String, failed: Bool)? {
    switch publish.status {
    case .working where publish.stage == "waiting_for_app":
      let bundleID = publish.bundleId ?? ""
      return (String(localized: "Ett steg görs för hand hos Apple: skapa appen i App Store Connect (Apps > + > New App, iOS) och välj bundle-id \(bundleID). Uppladdningen fortsätter av sig själv när appen finns."), false)
    case .uploaded:
      let build = publish.build ?? ""
      if publish.tester == "added" {
        return (String(localized: "Version \(build) är uppladdad. Kontoägaren är tillagd som testare, så appen dyker upp i TestFlight-appen när Apple har bearbetat den, oftast efter några minuter."), false)
      }
      return (String(localized: "Version \(build) är uppladdad. Lägg till dig som testare under TestFlight i App Store Connect, så dyker den upp i TestFlight-appen."), false)
    case .failed:
      return (publishError(publish), true)
    default:
      return nil
    }
  }

  private static func publishError(_ publish: PublishState) -> String {
    switch publish.error {
    case "no_app_record":
      String(localized: "Appen finns inte i App Store Connect än. Skapa en ny app där med bundle-id \(publish.bundleId ?? "") och försök sedan igen.")
    case "compile": String(localized: "Appen går inte att bygga just nu. Be om en rättning i chatten och försök igen.")
    case "signing": String(localized: "Signeringen misslyckades. Kontrollera team och certifikat i utvecklarkontot.")
    case "auth": String(localized: "Apple godkände inte nyckeln. Kontrollera App Store Connect-nyckeln.")
    case "unavailable": String(localized: "Ingen byggserver som kan ladda upp är ansluten just nu.")
    default: String(localized: "Uppladdningen misslyckades. Försök igen om en stund.")
    }
  }

  // MARK: - App Store page

  /// What stops the page from being sent, by the server's code for it.
  static func listingProblem(_ code: String) -> String {
    switch code {
    case "name_missing": String(localized: "Ett namn")
    case "name_long": String(localized: "Namnet är för långt")
    case "subtitle_long": String(localized: "Underrubriken är för lång")
    case "promo_long": String(localized: "Kampanjtexten är för lång")
    case "description_missing": String(localized: "En beskrivning")
    case "description_long": String(localized: "Beskrivningen är för lång")
    case "keywords_missing": String(localized: "Sökord")
    case "keywords_long": String(localized: "Sökorden är för långa")
    case "support_url": String(localized: "En supportsida (en adress som börjar med https://)")
    case "marketing_url": String(localized: "Webbplatsen måste vara en adress som börjar med https://")
    case "privacy_url": String(localized: "En integritetspolicy (en adress som börjar med https://)")
    case "category": String(localized: "En kategori")
    case "screenshots": String(localized: "Minst en skärmbild")
    case "page_email": String(localized: "En e-postadress för support")
    case "page_policy": String(localized: "En integritetspolicy (minst ett par meningar)")
    default: code
    }
  }

  static func storeStage(_ stage: String?) -> String {
    switch stage {
    case "version": String(localized: "Öppnar versionen")
    case "texts": String(localized: "Skickar texter")
    case "screenshots": String(localized: "Laddar upp skärmbilder")
    case "build": String(localized: "Väljer bygge")
    case "details": String(localized: "Fyller i övriga uppgifter")
    default: String(localized: "Väntar")
    }
  }

  /// Why the page could not be sent, or the app not submitted.
  static func storeError(_ code: String?, detail: String?, submitting: Bool) -> String {
    switch code {
    case "no_app_record":
      String(localized: "Appen finns inte i App Store Connect än. Gör den installerbar först; då får du hjälp att skapa den.")
    case "auth": String(localized: "Apple godkände inte nyckeln. Kontrollera kopplingen till utvecklarkontot.")
    case "locked":
      submitting
        ? String(localized: "Appen har ingen version som väntar på att skickas in. Den kan redan vara inskickad.")
        : String(localized: "Appens version granskas eller är redan släppt, så sidan kan inte ändras härifrån.")
    case "rejected":
      submitting
        ? String(localized: "Apple tog inte emot appen än: \(detail ?? "")")
        : String(localized: "Apple godkände inte allt på sidan: \(detail ?? "")")
    case "unavailable": String(localized: "Ingen byggserver som kan nå Apple är ansluten just nu.")
    default:
      submitting
        ? String(localized: "Det gick inte att skicka in appen. Försök igen om en stund.")
        : String(localized: "Det gick inte att skicka sidan. Försök igen om en stund.")
    }
  }

  /// What to do about the things Apple most often finds missing when an app is submitted.
  static func refusalHints(_ detail: String) -> [String] {
    var hints: [String] = []
    if detail.localizedCaseInsensitiveContains("contentRightsDeclaration") {
      hints.append(String(localized: "Rättigheter till innehåll: slå på \"Inget material från andra\" om det stämmer och skicka sidan igen."))
    }
    if detail.localizedCaseInsensitiveContains("medical device") {
      hints.append(String(localized: "Medicinteknisk produkt: det går bara att ange i App Store Connect, under App Compliance. För en vanlig app är svaret nej."))
    }
    if detail.localizedCaseInsensitiveContains("privacy") {
      hints.append(String(localized: "Integritet: svara på frågorna under App Privacy i App Store Connect."))
    }
    return hints
  }

  static func attached(_ state: String?, build: String) -> String {
    switch state {
    case "attached": String(localized: "Bygget \(build) är valt för versionen.")
    case "processing": String(localized: "Apple bearbetar fortfarande bygget \(build). Skicka sidan igen om några minuter.")
    default: String(localized: "Inget bygge är valt. Gör appen installerbar först och skicka sidan igen.")
    }
  }

  static func contactProblem(_ problem: ReviewContact.Problem) -> String {
    switch problem {
    case .name: String(localized: "För- och efternamn saknas.")
    case .phone: String(localized: "Telefonnumret behöver landsnummer, till exempel +46 70 123 45 67.")
    case .email: String(localized: "E-postadressen ser inte rätt ut.")
    }
  }

  /// Apple's primary categories, by their ids.
  static let categories: [(id: String, name: String)] = [
    ("BOOKS", String(localized: "Böcker")),
    ("BUSINESS", String(localized: "Företag")),
    ("DEVELOPER_TOOLS", String(localized: "Utvecklarverktyg")),
    ("EDUCATION", String(localized: "Utbildning")),
    ("ENTERTAINMENT", String(localized: "Nöje")),
    ("FINANCE", String(localized: "Ekonomi")),
    ("FOOD_AND_DRINK", String(localized: "Mat och dryck")),
    ("GRAPHICS_AND_DESIGN", String(localized: "Grafik och design")),
    ("HEALTH_AND_FITNESS", String(localized: "Hälsa och träning")),
    ("LIFESTYLE", String(localized: "Livsstil")),
    ("MEDICAL", String(localized: "Medicin")),
    ("MUSIC", String(localized: "Musik")),
    ("NAVIGATION", String(localized: "Navigering")),
    ("NEWS", String(localized: "Nyheter")),
    ("PHOTO_AND_VIDEO", String(localized: "Foto och video")),
    ("PRODUCTIVITY", String(localized: "Produktivitet")),
    ("REFERENCE", String(localized: "Referens")),
    ("SHOPPING", String(localized: "Shopping")),
    ("SOCIAL_NETWORKING", String(localized: "Sociala nätverk")),
    ("SPORTS", String(localized: "Sport")),
    ("TRAVEL", String(localized: "Resor")),
    ("UTILITIES", String(localized: "Verktyg")),
    ("WEATHER", String(localized: "Väder")),
  ]
}

extension String {
  /// The first sentence, for the card that asks about installing: the card is a question, and a long
  /// answer above it would bury it. Cut at the first full stop, question mark, exclamation mark or
  /// line break; a first sentence that runs on is cut at a word with an ellipsis. The same as
  /// `firstSentence` on the server's side.
  func firstSentence(max: Int = 140) -> String {
    let line = trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
    var sentence = line
    if let end = line.firstMatch(of: /[.!?](?=\s|$)/) { sentence = String(line[..<end.range.upperBound]) }
    guard sentence.count > max else { return sentence }
    let cut = sentence.prefix(max)
    let stop = cut.lastIndex(of: " ").map { cut.distance(from: cut.startIndex, to: $0) } ?? max
    let kept = cut.prefix(Swift.max(stop, max - 30))
    return kept.replacing(/[\s,;:–-]+$/, with: "") + "…"
  }
}
