// Straight onto this phone, without TestFlight: the phone is added once (it hands over its
// identifier through a small profile, in Safari), and after that every build is signed for it and
// installed with one tap.
import SwiftUI

struct DirectInstallSection: View {
  let store: ProjectStore
  let api: API
  let direct: DirectInstall

  @Environment(\.openURL) private var openURL
  @State private var isBusy = false
  @State private var errorText: String?

  private var isWorking: Bool { direct.status == .working }
  private var installURL: URL? {
    guard direct.status == .ready, let path = direct.path else { return nil }
    return api.installURL(forPagePath: path)
  }

  var body: some View {
    Section {
      if direct.phones == 0 {
        Text("Lägg till telefonen en gång. Sedan byggs appen för just den och installeras med ett tryck, utan TestFlight.")
          .foregroundStyle(.secondary)
        Button("Lägg till den här telefonen") { addPhone() }
          .buttonStyle(.bouncy)
          .disabled(isBusy)
      } else {
        if isWorking {
          HStack(spacing: 12) {
            MascotBadge(isDancing: true)
              .frame(width: 40)
            Text(Texts.directStage(direct.stage))
              .font(.subheadline.weight(.semibold))
          }
          .accessibilityElement(children: .combine)
        } else if let installURL {
          Button("Installera på den här telefonen") { openURL(installURL) }
            .buttonStyle(.bouncy)
          Button("Bygg en ny version") { build() }
            .disabled(isBusy || store.isRunning || !direct.available)
        } else {
          Button("Bygg för den här telefonen") { build() }
            .buttonStyle(.bouncy)
            .disabled(isBusy || store.isRunning || !direct.available)
        }
        if direct.status == .failed {
          Text(Texts.directError(direct.error))
            .font(.footnote)
            .foregroundStyle(.red)
        }
        if direct.phones < direct.maxPhones {
          Button("Lägg till en telefon till") { addPhone() }
            .font(.footnote)
            .disabled(isBusy)
        }
      }
      if let errorText {
        Text(errorText)
          .font(.footnote)
          .foregroundStyle(.red)
      }
    } header: {
      Text("Direkt på telefonen")
    } footer: {
      if direct.phones == 0 {
        Text("Safari öppnas med stegen. Telefonen lämnar bara sitt id, och ingenting blir kvar på den.")
      } else if installURL != nil {
        Text("iOS frågar om du vill installera. Första gången ber appen dig slå på Utvecklarläge under Inställningar, Integritet och säkerhet.")
      } else if !direct.available {
        Text("Ingen byggserver som kan signera är ansluten just nu.")
      } else if store.isRunning {
        Text("Vänta tills appen är färdigbyggd i chatten.")
      } else if !isWorking {
        Text("Det tar ett par minuter att bygga appen för telefonen.")
      }
    }
    .listRowSeparator(.hidden)
  }

  private func addPhone() {
    run { () throws(APIError) in
      // The profile can only be fetched in Safari, which is where this opens.
      openURL(try await api.addPhoneURL())
    }
  }

  private func build() {
    run { () throws(APIError) in try await api.buildForPhone(store.id) }
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
