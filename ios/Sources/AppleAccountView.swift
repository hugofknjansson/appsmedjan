// Connecting the person's own Apple developer account, so their apps are uploaded and published in
// their own name.
import SwiftUI
import UniformTypeIdentifiers

struct AppleAccountView: View {
  let api: API

  @Environment(\.dismiss) private var dismiss
  @State private var status: AppleStatus?
  @State private var key = ""
  @State private var keyID = ""
  @State private var issuerID = ""
  @State private var teamID = ""
  /// Apple usually reveals the team by itself; the field appears only when it does not.
  @State private var needsTeam = false
  @State private var isPickingFile = false
  @State private var isBusy = false
  @State private var isConfirmingDisconnect = false
  @State private var errorText: String?

  private static let enroll = URL(string: "https://developer.apple.com/programs/enroll/")!
  private static let keys = URL(string: "https://appstoreconnect.apple.com/access/integrations/api")!

  var body: some View {
    NavigationStack {
      Form {
        if let status {
          if status.connected {
            connected(status)
          } else if status.enabled {
            guide
          } else {
            Text("Koppling av egna Apple-konton är inte påslagen här.")
          }
        } else if errorText == nil {
          ProgressView()
        }
        if let errorText {
          Section { Text(errorText).foregroundStyle(.red) }
        }
      }
      .paperBackground()
      .navigationTitle("Apple-utvecklarkonto")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
      }
      .task { await load() }
      .fileImporter(isPresented: $isPickingFile, allowedContentTypes: [.data, .text]) { result in
        if case .success(let url) = result { read(url) }
      }
    }
  }

  private func connected(_ status: AppleStatus) -> some View {
    Section {
      Label("Kopplat till team \(status.teamId ?? "") med nyckel \(status.keyId ?? "").", systemImage: "checkmark.seal")
      Button("Koppla från", role: .destructive) { isConfirmingDisconnect = true }
        .disabled(isBusy)
        .confirmationDialog("Koppla från Apple-kontot?", isPresented: $isConfirmingDisconnect, titleVisibility: .visible) {
          Button("Koppla från", role: .destructive) {
            run { () throws(APIError) in self.status = try await api.disconnectApple() }
          }
        }
    } footer: {
      Text("Dina appar laddas upp till ditt eget konto och publiceras i ditt namn.")
    }
  }

  @ViewBuilder
  private var guide: some View {
    Section {
      Text("Gå med i Apple Developer Program som privatperson. Det kostar 99 USD per år och du behöver ett Apple-konto med tvåfaktorsautentisering. Apple behöver ibland ett par dagar på sig att godkänna.")
      Link("Gå med i programmet", destination: Self.enroll)
    } header: {
      Text("1. Skaffa ett utvecklarkonto")
    }

    Section {
      Text("Skapa en nyckel under Users and Access > Integrations > App Store Connect API, med rollen Admin. Ladda ner filen: den går bara att hämta en gång.")
      Link("Öppna nyckelsidan", destination: Self.keys)
    } header: {
      Text("2. Skapa en nyckel")
    }

    Section {
      Button(key.isEmpty ? "Välj nyckelfilen (.p8)" : "Nyckelfilen är vald", systemImage: key.isEmpty ? "doc.badge.plus" : "checkmark.circle") {
        isPickingFile = true
      }
      TextField("Key ID", text: $keyID)
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
      TextField("Issuer ID", text: $issuerID)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
      if needsTeam {
        TextField("Team ID", text: $teamID)
          .textInputAutocapitalization(.characters)
          .autocorrectionDisabled()
      }
      Button(isBusy ? "Kontrollerar" : "Koppla kontot") {
        run { () throws(APIError) in
          status = try await api.connectApple(key: key, keyID: keyID, issuerID: issuerID, teamID: teamID)
          key = ""
        }
      }
      .disabled(isBusy || key.isEmpty || keyID.isEmpty || issuerID.isEmpty)
    } header: {
      Text("3. Koppla nyckeln")
    } footer: {
      Text("Key ID står bredvid nyckeln och Issuer ID överst på samma sida. Nyckeln sparas krypterad och används bara för att ladda upp dina appar.")
    }
  }

  private func load() async {
    do throws(APIError) {
      status = try await api.appleAccount()
    } catch {
      errorText = Texts.apiError(error.code)
    }
  }

  /// Reads the key file. Apple names it after the key, which fills in the Key ID.
  private func read(_ url: URL) {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    guard let data = try? Data(contentsOf: url), data.count <= 4000, let text = String(data: data, encoding: .utf8), text.contains("PRIVATE KEY") else {
      errorText = String(localized: "Det där är inte nyckelfilen från Apple. Den heter AuthKey_… och slutar på .p8.")
      return
    }
    errorText = nil
    key = text
    if let match = url.lastPathComponent.firstMatch(of: /AuthKey_([A-Za-z0-9]+)\.p8$/) { keyID = match.1.uppercased() }
  }

  private func run(_ action: @escaping () async throws(APIError) -> Void) {
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        try await action()
      } catch {
        if error.code == "apple_team_needed" { needsTeam = true }
        errorText = Texts.apiError(error.code)
      }
    }
  }
}
