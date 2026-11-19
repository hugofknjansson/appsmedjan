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
    case "too_many_attempts": String(localized: "För många försök. Vänta en stund och försök igen.")
    case "daily_limit": String(localized: "Du har nått dagens gräns för meddelanden. Välkommen tillbaka i morgon.")
    case "project_limit": String(localized: "Du har nått gränsen för antal appar. Ta bort en app för att skapa en ny.")
    case "bad_prompt": String(localized: "Skriv vad du vill bygga (högst 8000 tecken).")
    case "busy": String(localized: "Vänta tills det pågående arbetet är klart.")
    case "publish_forbidden": String(localized: "Ditt konto får inte skicka appar till TestFlight.")
    case "publish_unavailable": String(localized: "TestFlight är inte tillgängligt just nu.")
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

  static func step(_ step: Step) -> String {
    switch step.kind {
    case .build:
      switch step.status {
      case .done: String(localized: "Appen är uppdaterad")
      case .error: String(localized: "Hittade ett fel och rättar det")
      case .running: String(localized: "Bygger appen")
      }
    case .look: String(localized: "Tittar på skärmen")
    case .rename: String(localized: "Döper appen till \(step.detail.isEmpty ? "…" : step.detail)")
    case .write: String(localized: "Skriver \(friendlyName(step.detail))")
    case .edit: String(localized: "Justerar \(friendlyName(step.detail))")
    case .delete: String(localized: "Tar bort \(friendlyName(step.detail))")
    case .read: String(localized: "Läser \(friendlyName(step.detail))")
    case .other: String(localized: "Arbetar")
    }
  }

  /// "Sources/Views/HabitListView.swift" becomes "Habit List View".
  static func friendlyName(_ path: String) -> String {
    let file = path.split(separator: "/").last.map(String.init) ?? ""
    let base = file.replacing(/\.[a-z]+$/, with: "")
    let spaced = base
      .replacing(/([a-z0-9])([A-Z])/) { "\($0.1) \($0.2)" }
      .replacing(/[_+-]+/, with: " ")
      .trimmingCharacters(in: .whitespaces)
    return spaced.isEmpty ? String(localized: "en del av appen") : spaced
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
}
