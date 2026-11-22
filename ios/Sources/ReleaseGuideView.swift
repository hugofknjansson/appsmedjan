// Getting the app out: one place that asks where the person wants it, on their own phone or in
// the App Store, and shows the steps to there, how far they have come, and what is theirs to do
// next. The steps themselves are done in the screens that already exist; this is the map.
import SwiftUI

/// Where the person wants the app.
nonisolated enum ReleaseGoal: String, Identifiable {
  case phone, store
  var id: Self { self }
}

/// How far the person has come towards each goal. Worked out on the server: `releaseGuide`.
nonisolated struct ReleaseGuide: Decodable, Equatable {
  nonisolated struct Step: Decodable, Equatable, Identifiable {
    nonisolated enum Kind: String, LenientEnum {
      case member, key, phone, install, app, page, privacy, submit, other
      static let fallback = Kind.other
    }

    nonisolated enum State: String, LenientEnum {
      case done, now, working, later
      static let fallback = State.later
    }

    let id: Kind
    let state: State
    /// For the app at Apple, while it is waited for: the id to pick when making it there.
    var bundleId: String?
    /// Apple's own words, when it said no to something.
    var detail: String?
  }

  var phone: [Step]
  var store: [Step]
  var account: PublishState.Account
  var canConnect: Bool
}

extension API {
  func release(_ id: String) async throws(APIError) -> ReleaseGuide {
    try await get("api/projects/\(id)/release")
  }
}

struct ReleaseGuideView: View {
  private enum Sheet: String, Identifiable {
    case account, page, testers
    var id: Self { self }
  }

  let store: ProjectStore
  let api: API
  /// Goes to where the app is put on the person's own phone.
  let showPhone: () -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var goal: ReleaseGoal
  @State private var guide: ReleaseGuide?
  @State private var sheet: Sheet?
  @State private var isBusy = false
  @State private var errorText: String?

  private static let developerApp = URL(string: "https://apps.apple.com/app/apple-developer/id640199958")!
  private static let connectApp = URL(string: "https://apps.apple.com/app/app-store-connect/id1234793120")!
  private static let connect = URL(string: "https://appstoreconnect.apple.com/apps")!

  init(store: ProjectStore, api: API, goal: ReleaseGoal, showPhone: @escaping () -> Void) {
    self.store = store
    self.api = api
    self.showPhone = showPhone
    _goal = State(initialValue: goal)
  }

  private var steps: [ReleaseGuide.Step] {
    (goal == .phone ? guide?.phone : guide?.store)?.filter { $0.id != .other } ?? []
  }

  private var isAllDone: Bool { !steps.isEmpty && steps.allSatisfy { $0.state == .done } }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          HStack(spacing: 12) {
            goalCard(.phone, title: "På min telefon", text: "En egen ikon på din hemskärm", symbol: "iphone")
            goalCard(.store, title: "I App Store", text: "Så att vem som helst kan hämta den", symbol: "bag.fill")
          }

          if let guide {
            if guide.account == .none, !guide.canConnect {
              Text("Det här är inte påslaget för ditt konto. Hör av dig till den som driver tjänsten.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .card()
            } else {
              Text(intro)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)
              VStack(alignment: .leading, spacing: 18) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                  row(step, number: index + 1)
                }
              }
              .card(padding: 18)
              .animation(.smooth, value: steps)
              if isAllDone { done }
            }
          } else if errorText == nil {
            ProgressView().padding(.top, 40)
          }

          if let errorText {
            Text(errorText).font(.footnote).foregroundStyle(.red)
          }
          if goal == .store, guide?.account != PublishState.Account.none {
            Button("Dela med testare genom TestFlight först") { sheet = .testers }
              .font(.footnote.weight(.semibold))
          }
        }
        .padding()
      }
      .paperBackground()
      .navigationTitle("Få ut din app")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Stäng") { dismiss() } }
      }
      .sheet(item: $sheet, onDismiss: { Task { await load() } }) { sheet in
        switch sheet {
        case .account: AppleAccountView(api: api)
        case .page: StoreView(projectID: store.id, api: api)
        case .testers: InstallView(store: store, api: api)
        }
      }
      // What the person does at Apple is not told to us; it is asked for now and then while this is open.
      .task {
        while !Task.isCancelled {
          await load()
          try? await Task.sleep(for: .seconds(4))
        }
      }
      .onChange(of: store.publish) { Task { await load() } }
    }
  }

  private var intro: String {
    switch goal {
    case .phone: String(localized: "De två första stegen gör du en gång. Sedan gäller de alla dina appar.")
    case .store: String(localized: "De två första stegen gör du en gång. Resten gör du för varje app du vill ge ut.")
    }
  }

  private func goalCard(_ choice: ReleaseGoal, title: LocalizedStringKey, text: LocalizedStringKey, symbol: String) -> some View {
    let isChosen = goal == choice
    return Button {
      withAnimation(.bouncy(duration: 0.3)) { goal = choice }
    } label: {
      VStack(alignment: .leading, spacing: 6) {
        Image(systemName: symbol)
          .font(.title2)
        Text(title)
          .font(.headline)
        Text(text)
          .font(.footnote)
          .opacity(0.85)
          .multilineTextAlignment(.leading)
      }
      .foregroundStyle(isChosen ? .white : .primary)
      .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
      .padding(14)
      .background(isChosen ? AnyShapeStyle(.brandGradient) : AnyShapeStyle(Color(.card)), in: .rect(cornerRadius: 22, style: .continuous))
    }
    .buttonStyle(.pop)
    .accessibilityAddTraits(isChosen ? .isSelected : [])
  }

  // MARK: A step

  private func row(_ step: ReleaseGuide.Step, number: Int) -> some View {
    HStack(alignment: .top, spacing: 12) {
      mark(step.state, number: number)
      VStack(alignment: .leading, spacing: 6) {
        Text(title(step.id))
          .font(step.state == .now ? .headline : .body)
          .foregroundStyle(step.state == .later ? .secondary : .primary)
        if step.state == .now || step.state == .working {
          Text(text(step))
            .font(.subheadline)
            .foregroundStyle(.secondary)
          if let id = step.bundleId {
            Text(verbatim: id)
              .font(.footnote.monospaced())
              .textSelection(.enabled)
              .padding(.horizontal, 10)
              .padding(.vertical, 6)
              .background(Color(.paper), in: .rect(cornerRadius: 8))
          }
          if let detail = step.detail {
            Text(detail)
              .font(.footnote)
              .foregroundStyle(.red)
          }
        }
        if step.state == .now, let action = action(step) {
          Button(action.label, action: action.run)
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16)
            .frame(minHeight: 40)
            .foregroundStyle(.white)
            .background(.brandGradient, in: .capsule)
            .buttonStyle(.pop)
            .disabled(isBusy)
            .padding(.top, 2)
        }
      }
      Spacer(minLength: 0)
    }
    .accessibilityElement(children: .combine)
    .accessibilityValue(Text(stateName(step.state)))
  }

  @ViewBuilder
  private func mark(_ state: ReleaseGuide.Step.State, number: Int) -> some View {
    switch state {
    case .done:
      Image(systemName: "checkmark.circle.fill")
        .font(.title2)
        .foregroundStyle(.green)
        .frame(width: 28, height: 28)
    case .working:
      ProgressView()
        .frame(width: 28, height: 28)
    case .now, .later:
      Text(verbatim: "\(number)")
        .font(.subheadline.weight(.bold))
        .foregroundStyle(state == .now ? .white : .secondary)
        .frame(width: 28, height: 28)
        .background(state == .now ? AnyShapeStyle(.brandGradient) : AnyShapeStyle(Color(.paper)), in: .circle)
    }
  }

  private func stateName(_ state: ReleaseGuide.Step.State) -> String {
    switch state {
    case .done: String(localized: "Klart")
    case .now: String(localized: "Din tur")
    case .working: String(localized: "Pågår")
    case .later: String(localized: "Väntar")
    }
  }

  private func title(_ step: ReleaseGuide.Step.Kind) -> String {
    switch step {
    case .member: String(localized: "Bli medlem hos Apple")
    case .key: String(localized: "Koppla ditt Apple-konto hit")
    case .phone: String(localized: "Lägg till din telefon")
    case .install: String(localized: "Installera appen")
    case .app: String(localized: "Skapa appen hos Apple")
    case .page: String(localized: "Fyll i appens sida")
    case .privacy: String(localized: "Svara på Apples frågor om integritet")
    case .submit: String(localized: "Skicka in för granskning")
    case .other: ""
    }
  }

  private func text(_ step: ReleaseGuide.Step) -> String {
    switch step.id {
    case .member:
      String(localized: "Det görs i Apples app Apple Developer och kostar 99 USD per år. Apple kan behöva ett par dagar på sig att godkänna.")
    case .key:
      String(localized: "Du skapar en nyckel hos Apple och lämnar den här, så att vi kan sköta resten åt dig. Vi visar hur.")
    case .phone:
      String(localized: "Telefonen lämnar sitt id en gång, i Safari. Sedan kan dina appar signeras för just den.")
    case .install:
      step.state == .working
        ? String(localized: "Appen görs klar för din telefon.")
        : String(localized: "Vi signerar appen för din telefon. Första gången ber telefonen dig slå på Utvecklarläge under Inställningar.")
    case .app:
      if step.bundleId != nil {
        String(localized: "Skapa en ny app i App Store Connect och välj det här id:t i listan. Det kan bara du göra. Uppladdningen fortsätter av sig själv när appen finns.")
      } else if step.state == .working {
        String(localized: "Appen laddas upp till ditt konto.")
      } else {
        String(localized: "Vi laddar upp appen till ditt konto. Första gången ber vi dig skapa den hos Apple, och säger då exakt vad du ska välja.")
      }
    case .page:
      step.state == .working
        ? String(localized: "Sidan skickas till Apple.")
        : String(localized: "Namn, beskrivning, bilder och ikon. Det mesta är förberett; du ser över det och skickar sidan till Apple.")
    case .privacy:
      String(localized: "Apple vill veta vilka uppgifter appen samlar in. Det går bara att svara på hos Apple, under App Privacy på appens sida där.")
    case .submit:
      step.state == .working
        ? String(localized: "Appen lämnas till Apples granskning.")
        : String(localized: "Apple granskar appen, oftast inom ett par dagar, och säger till när den är godkänd.")
    case .other: ""
    }
  }

  /// What the person can press to get on with a step that is theirs to do.
  private struct StepAction {
    let label: String
    let run: () -> Void
  }

  private func action(_ step: ReleaseGuide.Step) -> StepAction? {
    switch step.id {
    case .member:
      return StepAction(label: String(localized: "Öppna Apple Developer")) { openURL(Self.developerApp) }
    case .key:
      return StepAction(label: String(localized: "Koppla kontot")) { sheet = .account }
    case .phone, .install:
      return StepAction(label: String(localized: "Öppna Min telefon")) {
        dismiss()
        showPhone()
      }
    case .app:
      if step.bundleId != nil {
        return StepAction(label: String(localized: "Öppna App Store Connect")) { openURL(Self.connect) }
      }
      return StepAction(label: String(localized: "Ladda upp appen"), run: upload)
    case .page, .submit:
      return StepAction(label: String(localized: "Öppna appens sida")) { sheet = .page }
    case .privacy:
      return StepAction(label: String(localized: "Öppna App Store Connect")) { openURL(Self.connect) }
    case .other:
      return nil
    }
  }

  private var done: some View {
    VStack(spacing: 10) {
      Mascot(isCheering: true)
        .frame(width: 80)
      Text(goal == .phone ? "Appen ligger på din hemskärm." : "Appen är inskickad till Apple.")
        .font(.headline)
        .multilineTextAlignment(.center)
      if goal == .store {
        Text("Du kan följa granskningen i Apples app App Store Connect, som säger till när appen är godkänd.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        Button("Hämta App Store Connect") { openURL(Self.connectApp) }
          .font(.subheadline.weight(.semibold))
      }
    }
    .frame(maxWidth: .infinity)
    .card(padding: 20)
  }

  // MARK: Doing

  private func load() async {
    do throws(APIError) {
      let loaded = try await api.release(store.id)
      if loaded != guide { guide = loaded }
      if errorText != nil, !isBusy { errorText = nil }
    } catch {
      if guide == nil { errorText = Texts.apiError(error.code) }
    }
  }

  private func upload() {
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        try await store.sendToTestFlight()
        await load()
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}
