// Turns the server's codes into sentences for people. The same wording as the web client.
import Foundation

enum Texts {
  /// For error codes from the REST API.
  static func apiError(_ code: String) -> String {
    switch code {
    case "network": String(localized: "Det gick inte att nå App Dance. Kontrollera din uppkoppling.")
    case "wrong_login": String(localized: "Fel e-post eller lösenord.")
    case "wrong_password": String(localized: "Fel lösenord.")
    case "email_unverified": String(localized: "Bekräfta din e-post först. Vi har skickat en länk till din adress.")
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
    case "plan_credits": String(localized: "Dina credits är slut. Be om en större plan under Min plan.")
    case "plan_install": String(localized: "Appen på telefonen ingår i planen Skapa. Du ber om den under Min plan.")
    case "plan_store": String(localized: "App Store-guiden ingår i planen Publicera. Du ber om den under Min plan.")
    case "bad_plan": String(localized: "Det gick inte att be om den planen.")
    case "bad_code": String(localized: "Koden stämmer inte.")
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
    case "store_unavailable": String(localized: "Det går inte att nå Apple just nu. Försök igen om en stund.")
    case "store_incomplete": String(localized: "Allt är inte ifyllt än.")
    case "store_not_ready": String(localized: "Ladda upp appen och skicka sidan till App Store Connect först, och fyll i kontaktuppgifterna.")
    case "bad_contact": String(localized: "Kontaktuppgifterna gick inte att spara.")
    case "not_uploaded": String(localized: "Appen är inte uppladdad än.")
    case "fast_unavailable": String(localized: "Det går inte att bjuda in testare just nu.")
    case "no_api_key": String(localized: "Det går inte att bygga appar just nu. Felet ligger hos oss.")
    case "rate_limited": String(localized: "Det är många som bygger just nu. Vänta en liten stund och försök igen.")
    case "overloaded": String(localized: "Byggaren svarar inte just nu. Försök igen om en stund.")
    case "refused": String(localized: "Det gick inte att skriva ett förslag för den här appen.")
    case "too_long": String(localized: "Appen är för stor för att skriva ett förslag i ett steg.")
    case "apple_disabled": String(localized: "Koppling av egna Apple-konton är inte påslagen här.")
    case "apple_bad_input": String(localized: "Koden ser inte rätt ut. Kopiera den precis som den står hos Apple.")
    case "apple_key_invalid": String(localized: "Det där var inte nyckelfilen från Apple. Välj filen som heter AuthKey.")
    case "apple_key_rejected": String(localized: "Apple kände inte igen nyckeln. Kontrollera att koden och filen kommer från samma sida hos Apple.")
    case "apple_key_forbidden": String(localized: "Nyckeln får inte göra tillräckligt. Skapa en ny och välj Admin.")
    case "apple_team_needed": String(localized: "Apple visade inte vilket team kontot har. Fyll i ditt Team ID.")
    case "apple_unreachable": String(localized: "Det gick inte att nå Apple just nu. Försök igen om en stund.")
    default: String(localized: "Något gick fel. Försök igen.")
    }
  }

  /// For error parts inside the agent's answer.
  static func agentError(_ code: String) -> String {
    switch code {
    case "no_api_key": String(localized: "Det går inte att bygga appar just nu. Felet ligger hos oss.")
    case "rate_limited": String(localized: "Det är många som bygger just nu. Vänta en liten stund och försök igen.")
    case "overloaded": String(localized: "Byggaren svarar inte just nu. Försök igen om en stund.")
    case "refused": String(localized: "Det här kan jag tyvärr inte hjälpa till med. Prova att beskriva det på ett annat sätt.")
    case "stopped": String(localized: "Stoppat.")
    case "too_long": String(localized: "Det här blev för stort för ett enda steg. Be om en mindre del i taget.")
    default: String(localized: "Något gick fel hos oss. Försök igen.")
    }
  }

  static func buildStage(_ stage: String?) -> String {
    switch stage {
    case "queued": String(localized: "Väntar på en ledig plats")
    case "preparing": String(localized: "Förbereder")
    case "compiling": String(localized: "Bygger appen")
    case "installing": String(localized: "Installerar")
    case "launching": String(localized: "Startar appen")
    default: String(localized: "Startar förhandsvisningen")
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

  /// What a plan holds, as lines to read: its credits where credits are counted, otherwise its messages.
  static func planLines(_ limits: PlanLimits, credits: Bool = false) -> [String] {
    var lines = [
      limits.apps == 1 ? String(localized: "1 app") : String(localized: "\(limits.apps) appar"),
    ]
    if credits, let amount = limits.credits {
      lines.append(limits.creditsOnce == true ? String(localized: "\(amount) credits att börja med") : String(localized: "\(amount) credits i månaden"))
    } else {
      lines.append(String(localized: "\(limits.messages) meddelanden till byggaren i månaden"))
    }
    if limits.install { lines.append(String(localized: "Appen på din egen telefon")) }
    if limits.store { lines.append(String(localized: "Hjälp att lägga upp appen i App Store")) }
    return lines
  }

  /// A number of credits, as a person says it.
  static func credits(_ amount: Int) -> String {
    amount == 1 ? String(localized: "1 credit") : String(localized: "\(amount) credits")
  }

  static func directStage(_ stage: String?) -> String {
    switch stage {
    case "preparing": String(localized: "Förbereder")
    case "archiving": String(localized: "Bygger appen")
    case "signing": String(localized: "Gör i ordning för din telefon")
    default: String(localized: "Väntar på tur")
    }
  }

  static func directError(_ code: String?) -> String {
    switch code {
    case "no_phones": String(localized: "Lägg till din telefon först.")
    case "phone_processing": String(localized: "Apple har tagit emot telefonen men släpper inte in den i appar än. Det kan ta upp till tre dygn i ett nytt konto. Försök igen senare.")
    case "phone_limit": String(localized: "Det finns inte plats för fler telefoner i år. Hör av dig till oss.")
    case "compile": String(localized: "Appen gick inte att bygga. Be om en rättning i chatten och försök igen.")
    case "signing", "auth": String(localized: "Appen gick inte att göra i ordning för din telefon. Felet ligger hos oss, och vi har fått veta det.")
    case "unavailable": String(localized: "Det går inte att installera på telefonen just nu. Försök igen om en stund.")
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
      return (String(localized: "Ett steg gör du själv hos Apple: tryck på plus, välj New App och iOS, och välj \(bundleID) i listan Bundle ID. Uppladdningen fortsätter av sig själv när appen finns."), false)
    case .uploaded:
      if publish.tester == "added" {
        return (String(localized: "Appen är uppladdad. Du är tillagd som testare, så appen dyker upp i TestFlight-appen när Apple är klar, oftast efter några minuter."), false)
      }
      return (String(localized: "Appen är uppladdad. Lägg till dig som testare under TestFlight i App Store Connect, så dyker den upp i TestFlight-appen."), false)
    case .failed:
      return (publishError(publish), true)
    default:
      return nil
    }
  }

  private static func publishError(_ publish: PublishState) -> String {
    switch publish.error {
    case "no_app_record":
      String(localized: "Appen finns inte hos Apple än. Skapa en ny app i App Store Connect, välj \(publish.bundleId ?? "") i listan Bundle ID och försök igen.")
    case "compile": String(localized: "Appen går inte att bygga just nu. Be om en rättning i chatten och försök igen.")
    case "signing": String(localized: "Uppladdningen misslyckades. Felet ligger hos oss, inte i din app. Försök igen om en stund.")
    case "auth":
      publish.account == .own
        ? String(localized: "Apple godkände inte din nyckel. Öppna Apple-konto i menyn bland dina appar och koppla kontot igen.")
        : String(localized: "Uppladdningen misslyckades. Felet ligger hos oss, inte i din app. Försök igen om en stund.")
    case "unavailable": String(localized: "Det går inte att ladda upp just nu. Försök igen om en stund.")
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
    case "build": String(localized: "Kopplar ihop sidan med appen")
    case "details": String(localized: "Fyller i övriga uppgifter")
    default: String(localized: "Väntar")
    }
  }

  /// Why the page could not be sent, or the app not submitted.
  /// Apple's own words, when it turned something down, are shown behind a press: see `Detail`.
  static func storeError(_ code: String?, submitting: Bool) -> String {
    switch code {
    case "no_app_record":
      String(localized: "Appen finns inte i App Store Connect än. Gör den installerbar först; då får du hjälp att skapa den.")
    case "auth": String(localized: "Apple godkände inte nyckeln. Öppna Apple-konto i menyn bland dina appar och koppla kontot igen.")
    case "locked":
      submitting
        ? String(localized: "Appen har ingen version som väntar på att skickas in. Den kan redan vara inskickad.")
        : String(localized: "Appens version granskas eller är redan släppt, så sidan kan inte ändras härifrån.")
    case "rejected":
      submitting
        ? String(localized: "Apple tog inte emot appen än. Något saknas eller behöver rättas.")
        : String(localized: "Apple godkände inte allt på sidan. Något behöver rättas.")
    case "unavailable": String(localized: "Det går inte att nå Apple just nu. Försök igen om en stund.")
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

  static func attached(_ state: String?) -> String {
    switch state {
    case "attached": String(localized: "Sidan är skickad, och den senaste uppladdningen av appen är vald.")
    case "processing": String(localized: "Apple är inte klar med den senaste uppladdningen än. Skicka sidan igen om några minuter.")
    default: String(localized: "Appen är inte uppladdad än. Gör den installerbar först och skicka sidan igen.")
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

extension PublishState {
  /// How far an upload has come, between 0 and 1. The same numbers as `UPLOAD_PROGRESS` in the web client.
  var uploadProgress: Double {
    switch stage {
    case "preparing": 0.15
    case "waiting_for_app": 0.2
    case "archiving": 0.5
    case "uploading": 0.8
    default: 0.05
    }
  }
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
