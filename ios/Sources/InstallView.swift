// Getting the app onto this phone: the service uploads it, hands it to Apple's beta review, and
// gives back a public TestFlight link that needs no developer account.
import SwiftUI

struct InstallView: View {
  let store: ProjectStore
  let api: API

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var isBusy = false
  @State private var errorText: String?
  @State private var contact = ReviewContact()
  @State private var person = TesterPerson()
  @State private var isShowingAccount = false

  private var publish: PublishState { store.publish }
  private var test: TestLink { publish.test ?? TestLink(status: .none) }
  private var isUploading: Bool { publish.status == .working }
  private var isUploaded: Bool { publish.status == .uploaded }
  private var fast: FastTrack { publish.fast ?? FastTrack(available: false, status: .none) }
  /// Members of the developer team get every build without Apple's review.
  private var isInternal: Bool { isUploaded && publish.tester == "added" && (publish.operator == true || publish.account == .own) }
  private static let testFlightApp = URL(string: "https://apps.apple.com/app/testflight/id899247664")!

  var body: some View {
    NavigationStack {
      List {
        Section {
          Text("Då ligger appen på hemskärmen som en vanlig app. Det går via Apples testapp TestFlight, som är gratis. Du behöver inget utvecklarkonto.")
            .foregroundStyle(.secondary)
        }

        if publish.account == .none {
          Section {
            if publish.canConnect {
              Text("För att installera appen behövs ett Apple-utvecklarkonto att ladda upp den till.")
              Button("Koppla ditt Apple-utvecklarkonto") { isShowingAccount = true }
            } else {
              Text("Installation på telefonen är inte påslagen för ditt konto. Hör av dig till den som driver tjänsten.")
            }
          }
        } else {
          Section {
            Button {
              run { () throws(APIError) in try await store.sendToTestFlight() }
            } label: {
              if isUploading {
                Label(Texts.publishStage(publish.stage), systemImage: "arrow.up.circle")
              } else {
                Text(isUploaded ? "Skicka en ny version" : "Gör appen installerbar")
              }
            }
            .disabled(isBusy || isUploading || store.isRunning || !publish.available)
          } footer: {
            if !publish.available {
              Text("Ingen byggserver som kan ladda upp är ansluten just nu.")
            } else if store.isRunning {
              Text("Vänta tills appen är färdigbyggd i chatten.")
            }
          }

          progress
        }

        if let errorText {
          Section { Text(errorText).foregroundStyle(.red) }
        }
      }
      .navigationTitle("Installera appen")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
      }
      .sheet(isPresented: $isShowingAccount) {
        AppleAccountView(api: api)
      }
    }
  }

  /// Where the upload and Apple's review stand, and what the person can do about it.
  @ViewBuilder
  private var progress: some View {
    if isUploading && publish.stage == "waiting_for_app" {
      Section {
        if publish.account == .operator && publish.operator != true {
          Text("Appen behöver läggas upp hos Apple av den som driver tjänsten. Det görs för hand, så det kan ta en stund. Du behöver inte göra något.")
        } else if let note = Texts.publishNote(publish) {
          Text(note.text)
        }
      }
    } else if publish.status == .failed, let note = Texts.publishNote(publish) {
      Section { Text(note.text).foregroundStyle(.red) }
    } else if isUploaded {
      if isInternal {
        Section {
          Label("Du är testare i utvecklarkontot, så ingen granskning behövs. Öppna TestFlight-appen.", systemImage: "checkmark.circle")
          Link("Hämta TestFlight", destination: Self.testFlightApp)
        } header: {
          Text("Appen finns i TestFlight om några minuter")
        }
      }
      fastTrack
      switch test.status {
      case .none, .working, .processing:
        Section {
          Label("Apple tar emot appen. Det tar oftast en kvart. Du kan stänga den här rutan under tiden.", systemImage: "hourglass")
        }
      case .review:
        Section {
          Label("Apple går igenom appen innan länken får användas. Första gången kan det ta upp till ett par dagar; nya versioner går fortare.", systemImage: "checkmark.shield")
        }
      case .approved:
        if let link = test.url.flatMap(URL.init(string:)) {
          Section {
            Button("Öppna i TestFlight") { openURL(link) }
              .buttonStyle(.borderedProminent)
            ShareLink("Dela länken med andra", item: link)
          } header: {
            Text("Klart")
          } footer: {
            Text("Har du inte TestFlight installerat hämtar du den gratis i App Store först. Tryck sedan på Godkänn och Installera.")
          }
        }
      case .rejected:
        Section {
          Text("Apple godkände inte appen för test. Den som driver tjänsten har fått veta varför.").foregroundStyle(.red)
        }
      case .failed:
        Section {
          Text(Texts.storeError(test.error, detail: test.detail, submitting: false)).foregroundStyle(.red)
          Button("Försök igen") {
            run { () throws(APIError) in try await api.shareAgain(store.id) }
          }
          .disabled(isBusy)
        }
      case .needsContact:
        Section {
          ContactFields(contact: $contact)
          Button("Fortsätt") {
            run { () throws(APIError) in try await api.shareAgain(store.id, contact: contact) }
          }
          .disabled(isBusy || contact.problem != nil)
        } header: {
          Text("Kontaktperson")
        } footer: {
          Text("Apple vill veta vem de kan kontakta om appen. Fyll i det här en gång, så används det för alla dina appar.")
        }
      }
    }
  }

  /// The invitation to the operator's team, for people who would rather not wait for Apple's review.
  @ViewBuilder
  private var fastTrack: some View {
    switch fast.status {
    case .added:
      Section {
        Label("Öppna TestFlight-appen på telefonen. Nya versioner kommer dit på några minuter.", systemImage: "checkmark.circle")
        Link("Hämta TestFlight", destination: Self.testFlightApp)
      } header: {
        Text("Du är testare")
      }
    case .invited:
      Section {
        Label("Apple har skickat en inbjudan till \(fast.email ?? ""). Öppna mejlet och tacka ja. Sedan kommer appen till TestFlight inom några minuter.", systemImage: "envelope")
      }
    case .working:
      Section { Label("Skickar inbjudan", systemImage: "paperplane") }
    case .none, .failed:
      if fast.available && test.status != .approved {
        Section {
          if fast.status == .failed {
            Text("Det gick inte att bjuda in dig. \(fast.detail ?? "")").foregroundStyle(.red)
          }
          TextField("E-postadressen till ditt Apple-konto", text: $person.email)
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          TextField("Förnamn", text: $person.firstName)
            .textContentType(.givenName)
          TextField("Efternamn", text: $person.lastName)
            .textContentType(.familyName)
          Button("Bjud in mig som testare") {
            run { () throws(APIError) in try await api.fastTrack(store.id, person: person) }
          }
          .disabled(isBusy || !person.isComplete)
        } header: {
          Text("Vill du inte vänta?")
        } footer: {
          Text("Du kan bli testare direkt, utan att vänta på Apples granskning. Då bjuds du in till tjänstens utvecklarkonto hos Apple, med tillgång till enbart din app. Du tackar ja i ett mejl från Apple.")
        }
      }
    }
  }

  private func run(_ action: @escaping () async throws(APIError) -> Void) {
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        try await action()
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}

/// Name, phone and email of the person Apple may contact. Used by the install flow and the App Store guide.
struct ContactFields: View {
  @Binding var contact: ReviewContact

  var body: some View {
    TextField("Förnamn", text: $contact.firstName)
      .textContentType(.givenName)
    TextField("Efternamn", text: $contact.lastName)
      .textContentType(.familyName)
    TextField("Telefon, till exempel +46 70 123 45 67", text: $contact.phone)
      .textContentType(.telephoneNumber)
      .keyboardType(.phonePad)
    TextField("E-post", text: $contact.email)
      .textContentType(.emailAddress)
      .keyboardType(.emailAddress)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
  }
}
