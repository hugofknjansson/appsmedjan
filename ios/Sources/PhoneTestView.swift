// Trying the app on this very phone: one button builds it for the phone and hands it to iOS to
// install, and every step on the way is shown, from the build to the app file arriving.
import SwiftUI

struct PhoneTestView: View {
  let store: ProjectStore
  let api: API
  let direct: DirectInstall
  /// Shows the streamed simulator instead, for the person who would rather look than install.
  let showSimulator: () -> Void
  /// Shows the app over the whole screen, to try it as if it were installed.
  let tryNow: () -> Void

  @Environment(\.openURL) private var openURL
  @State private var isBusy = false
  @State private var errorText: String?
  /// Set when the person asked to install before a build was ready: iOS is asked as soon as one is.
  @State private var installsWhenReady = false

  private var installURL: URL? {
    guard direct.status == .ready, let path = direct.path else { return nil }
    return api.installURL(forPagePath: path)
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        if direct.phones == 0 {
          addPhone
        } else {
          install
        }
        if let errorText {
          Text(errorText)
            .font(.footnote)
            .foregroundStyle(.red)
        }
        Button("Prova appen utan att installera", action: tryNow)
          .font(.subheadline.weight(.semibold))
          .padding(.top, 4)
        Button("Visa förhandsvisningen i stället", action: showSimulator)
          .font(.footnote.weight(.semibold))
      }
      .padding()
    }
    // The build was asked for with the install button: iOS takes over the moment it is ready.
    .onChange(of: direct.status) { _, status in
      guard installsWhenReady, status != .working else { return }
      installsWhenReady = false
      if status == .ready, let installURL { openURL(installURL) }
    }
  }

  // MARK: Adding the phone

  private var addPhone: some View {
    VStack(spacing: 14) {
      Mascot()
        .frame(width: 120)
      Text("Testa appen på din egen telefon")
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
      Text("Lägg till telefonen en gång. Sedan byggs appen för just den och installeras med ett tryck, utan TestFlight.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("Lägg till den här telefonen") {
        run { () throws(APIError) in
          // The profile that hands over the phone's identifier can only be fetched in Safari.
          Notifications.ask()
          openURL(try await api.addPhoneURL(from: store.id))
        }
      }
      .buttonStyle(.bouncy)
      .disabled(isBusy)
      Text("Safari öppnas med stegen. Telefonen presenterar sig bara, och ingenting blir kvar på den.")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .card(padding: 22)
  }

  // MARK: Installing

  private var install: some View {
    VStack(spacing: 16) {
      VStack(spacing: 14) {
        Mascot(isDancing: direct.isOnItsWay)
          .frame(width: 110)
        Text(direct.headline)
          .font(.title3.weight(.bold))
          .multilineTextAlignment(.center)
        if direct.isOnItsWay {
          WaitingCaption(lines: WaitingLines.phone)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        if let progress = direct.progress {
          ProgressView(value: progress)
            .tint(.brand)
            .animation(.smooth, value: progress)
            .accessibilityLabel("Hur långt installationen har kommit")
        }
        if direct.status == .failed {
          Text(Texts.directError(direct.error))
            .font(.subheadline)
            .foregroundStyle(.red)
            .multilineTextAlignment(.center)
        }
        button
      }
      .card(padding: 22)

      InstallSteps(direct: direct)
        .card()

      Text(footnote)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 6)
    }
  }

  @ViewBuilder
  private var button: some View {
    switch direct.status {
    case .working:
      // Nothing to press while it is being built; the steps below say where it is.
      EmptyView()
    case .ready:
      Button(direct.install == "fetched" ? "Installera igen" : "Installera på telefonen") {
        if let installURL { openURL(installURL) }
      }
      .buttonStyle(.bouncy)
    case .idle, .failed:
      Button(direct.status == .failed ? "Försök igen" : "Installera på telefonen") {
        installsWhenReady = true
        Notifications.ask()
        run { () throws(APIError) in try await api.buildForPhone(store.id) }
      }
      .buttonStyle(.bouncy)
      .disabled(isBusy || store.isRunning || !direct.available)
    }
  }

  private var footnote: String {
    if !direct.available && direct.status != .ready {
      String(localized: "Det går inte att installera på telefonen just nu. Försök igen om en stund.")
    } else if store.isRunning {
      String(localized: "Appen byggs om i chatten. En ny version för telefonen görs klar av sig själv när det är färdigt.")
    } else {
      String(localized: "Första gången ber appen dig slå på Utvecklarläge under Inställningar, Integritet och säkerhet. Nya versioner görs klara av sig själva när du har ändrat något i chatten.")
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
        installsWhenReady = false
        errorText = Texts.apiError(error.code)
      }
    }
  }
}

/// The way onto the phone as four steps, each one waiting, under way or done.
private struct InstallSteps: View {
  private enum Mark { case waiting, active, done }

  let direct: DirectInstall

  private var steps: [(title: String, mark: Mark)] {
    let position = direct.position
    let titles = [
      String(localized: "Bygger appen"),
      String(localized: "Gör i ordning för din telefon"),
      String(localized: "Hämtas till telefonen"),
      String(localized: "Installeras på hemskärmen"),
    ]
    return titles.enumerated().map { index, title in
      (title, index < position.done ? .done : index == position.active ? .active : .waiting)
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      ForEach(steps, id: \.title) { step in
        HStack(spacing: 12) {
          switch step.mark {
          case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
          case .active:
            BusyMark(size: 22)
          case .waiting:
            Image(systemName: "circle").foregroundStyle(.tertiary)
          }
          Text(step.title)
            .fontWeight(step.mark == .active ? .semibold : .regular)
            .foregroundStyle(step.mark == .waiting ? .secondary : .primary)
        }
        .frame(height: 24)
        .accessibilityElement(children: .combine)
        .accessibilityValue(step.mark == .done ? Text("Klart") : step.mark == .active ? Text("Pågår") : Text("Väntar"))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension DirectInstall {
  /// True while something is moving: the build, or the app file on its way to the phone.
  var isOnItsWay: Bool {
    status == .working || (status == .ready && (install == "asked" || install == "fetching"))
  }

  /// How far the whole way onto the phone has come, between 0 and 1. Nil when nothing is on its way.
  /// The same numbers as `directProgress` on the server's side.
  var progress: Double? {
    switch status {
    case .working:
      switch stage {
      case "preparing": 0.15
      case "archiving": 0.4
      case "signing": 0.65
      default: 0.05
      }
    case .ready:
      switch install {
      case "asked": 0.85
      case "fetching": 0.92
      case "fetched": 1
      default: 0.75
      }
    case .idle, .failed:
      nil
    }
  }

  /// How many of the four steps are done, and which one is under way (nil when none is).
  var position: (done: Int, active: Int?) {
    switch status {
    case .working: stage == "signing" ? (1, 1) : (0, 0)
    case .ready:
      switch install {
      case "asked", "fetching": (2, 2)
      // What iOS does with the file cannot be seen from here; it takes a few seconds.
      case "fetched": (4, nil)
      default: (2, nil)
      }
    case .idle, .failed: (0, nil)
    }
  }

  var headline: String {
    switch status {
    case .working: stage == "signing" ? String(localized: "Gör i ordning för din telefon") : String(localized: "Bygger appen för din telefon")
    case .ready:
      switch install {
      case "asked", "fetching": String(localized: "Hämtas till telefonen")
      case "fetched": String(localized: "Klart. Appen ligger på hemskärmen.")
      default: String(localized: "Klar att installera")
      }
    case .failed: String(localized: "Det gick inte den här gången")
    case .idle: String(localized: "Testa appen på din egen telefon")
    }
  }
}
