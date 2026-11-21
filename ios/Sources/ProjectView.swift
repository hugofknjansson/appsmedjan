import SwiftUI

struct ProjectView: View {
  private enum Sheet: String, Identifiable {
    case install, store
    var id: String { rawValue }
  }

  @State private var store: ProjectStore
  @State private var pane = Pane.chat
  @State private var sheet: Sheet?
  /// The person has asked to see the streamed simulator, although their own phone is where apps are tried.
  @State private var showsSimulator = false
  @State private var cheers = 0

  /// The person's own phone comes first when apps can be installed straight onto it.
  private var phone: DirectInstall? {
    guard let direct = store.publish.direct, direct.isShown else { return nil }
    return direct
  }
  @Environment(\.dismiss) private var dismiss
  private let api: API

  init(project: ProjectSummary, api: API) {
    _store = State(initialValue: ProjectStore(project: project, api: api))
    self.api = api
  }

  var body: some View {
    VStack(spacing: 0) {
      PaneSwitcher(pane: $pane, isPhoneFirst: phone != nil)
        .padding(.horizontal)
        .padding(.vertical, 8)

      switch pane {
      case .chat: ChatView(store: store, api: api)
      case .preview:
        if let phone, !showsSimulator {
          PhoneTestView(store: store, api: api, direct: phone) { showsSimulator = true }
        } else {
          if phone != nil {
            Button("Tillbaka till min telefon", systemImage: "chevron.left") { showsSimulator = false }
              .font(.footnote.weight(.semibold))
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal)
          }
          PhoneView(store: store, api: api)
        }
      }
    }
    .background(Color(.paper))
    // Something to cheer about: the builder has finished, or the app has arrived on the phone.
    .overlay { Confetti(trigger: cheers) }
    .sensoryFeedback(.success, trigger: cheers)
    .onChange(of: store.isRunning) { was, running in
      if was && !running && !store.lastRunFailed { cheers += 1 }
    }
    .onChange(of: store.publish.direct) { before, now in
      // Only when it was seen arriving: not for an app that had already arrived when the screen was opened.
      if now?.install == "fetched", let before, before.status == .ready, before.install != "fetched" { cheers += 1 }
    }
    .navigationTitle(store.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("Installera på telefonen", systemImage: "arrow.down.app") { sheet = .install }
          Button("App Store", systemImage: "bag") { sheet = .store }
        } label: {
          if store.publish.status == .working {
            Label(Texts.publishStage(store.publish.stage), systemImage: "arrow.up.circle")
          } else {
            Label("Publicera", systemImage: "square.and.arrow.up")
          }
        }
      }
    }
    .sheet(item: $sheet) { sheet in
      switch sheet {
      case .install: InstallView(store: store, api: api)
      case .store: StoreView(projectID: store.id, api: api)
      }
    }
    .alert("Appen hittades inte.", isPresented: .constant(store.isMissing)) {
      Button("Alla appar") { dismiss() }
    }
    // The connection lives exactly as long as this screen is open.
    .task { await store.run() }
  }
}

// MARK: - Panes

private enum Pane: CaseIterable, Identifiable {
  case chat, preview

  var id: Self { self }

  /// The middle pane is the person's own phone when apps can be installed on it, otherwise the simulator.
  func title(isPhoneFirst: Bool) -> LocalizedStringKey {
    switch self {
    case .chat: "Chatt"
    case .preview: isPhoneFirst ? "Min telefon" : "Förhandsvisning"
    }
  }

  var symbol: String {
    switch self {
    case .chat: "bubble.left.and.bubble.right.fill"
    case .preview: "iphone"
    }
  }
}

/// Three pills, with an orange one that slides to the chosen pane.
private struct PaneSwitcher: View {
  @Binding var pane: Pane
  let isPhoneFirst: Bool
  @Namespace private var pills

  var body: some View {
    // The symbols are the first thing to go on a narrow phone, for all three pills at once.
    ViewThatFits(in: .horizontal) {
      row(withSymbols: true)
      row(withSymbols: false)
    }
    .padding(4)
    .background(Color(.card), in: .capsule)
  }

  private func row(withSymbols: Bool) -> some View {
    HStack(spacing: 4) {
      ForEach(Pane.allCases) { choice in
        Button {
          withAnimation(.bouncy(duration: 0.35)) { pane = choice }
        } label: {
          HStack(spacing: 6) {
            if withSymbols { Image(systemName: choice.symbol) }
            Text(choice.title(isPhoneFirst: isPhoneFirst))
          }
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
          // Never narrower than its words: the longest title takes the room it needs, the others share the rest.
          .fixedSize()
          .padding(.horizontal, 12)
          .frame(maxWidth: .infinity, minHeight: 38)
          .foregroundStyle(pane == choice ? .white : .primary)
          .background {
            if pane == choice {
              Capsule().fill(.brandGradient).matchedGeometryEffect(id: "chosen", in: pills)
            }
          }
          .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(pane == choice ? .isSelected : [])
      }
    }
  }
}

// MARK: - Chat

struct ChatView: View {
  let store: ProjectStore
  let api: API

  @Environment(\.openURL) private var openURL
  @State private var draft = ""
  @State private var isSending = false
  @State private var errorText: String?
  /// When the builder started on what it is doing now, for the clock beside the clues.
  @State private var runStartedAt: Date?
  /// Set when the person said yes to installing before a build was ready: iOS is asked as soon as one is.
  @State private var installsWhenReady = false
  @State private var isAsking = false
  @State private var isShowingPlan = false

  /// True when the owner's plan has no phone in it: the answer to "yes" is then the plans.
  private var isLocked: Bool { store.publish.plan?.install == false }

  private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// The person's own phone, when apps can be installed straight onto it.
  private var phone: DirectInstall? {
    guard let direct = store.publish.direct, direct.isShown else { return nil }
    return direct
  }

  /// After the wait, one thing: the question whether to put the app on the phone. The builder's last
  /// words go into that card instead of a bubble of their own.
  private var asked: ChatMessage? {
    guard phone != nil, !store.isRunning, !store.lastRunFailed, let last = store.messages.last, last.role == .assistant else { return nil }
    return last
  }

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          ForEach(store.messages) { message in
            switch message.role {
            case .assistant where message.id == asked?.id:
              EmptyView()
            case .user:
              Text(message.text)
                .foregroundStyle(.white)
                .padding(.horizontal, 15)
                .padding(.vertical, 10)
                .background(.brandGradient, in: .rect(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 6, topTrailingRadius: 20, style: .continuous))
                .padding(.leading, 44)
                .frame(maxWidth: .infinity, alignment: .trailing)
            case .assistant:
              PartsView(parts: message.parts)
            }
          }
          if store.isRunning {
            PartsView(parts: store.liveParts)
            ProgressCard(progress: RunProgress(parts: store.liveParts), startedAt: runStartedAt)
          } else if let asked, let phone {
            if phone.status == .working {
              ProgressCard(phone: phone, startedAt: nil)
            } else {
              InstallAsk(words: asked.lastWords, phone: phone, isLocked: isLocked, isBusy: !isLocked && (isAsking || !phone.available && phone.status != .ready)) {
                if isLocked { isShowingPlan = true } else { answer(phone) }
              }
            }
          }
        }
        .padding()
        .animation(.bouncy(duration: 0.4), value: store.isRunning)
        .animation(.bouncy(duration: 0.4), value: phone?.status)
      }
      // Follows new content, like a chat should.
      .defaultScrollAnchor(.bottom)
      .scrollDismissesKeyboard(.interactively)
      .onChange(of: store.isRunning, initial: true) { _, running in
        runStartedAt = running ? (runStartedAt ?? .now) : nil
      }
      // The build was asked for with the install button: iOS takes over the moment it is ready.
      .onChange(of: phone?.status) { _, status in
        guard installsWhenReady, status != .working else { return }
        installsWhenReady = false
        if status == .ready, let path = phone?.path, let url = api.installURL(forPagePath: path) { openURL(url) }
      }
      .sheet(isPresented: $isShowingPlan) {
        PlanView(api: api)
      }

      VStack(alignment: .leading, spacing: 6) {
        if let errorText {
          Text(errorText).font(.footnote).foregroundStyle(.red)
        }
        HStack(alignment: .bottom, spacing: 10) {
          TextField("Beskriv vad du vill ändra eller lägga till", text: $draft, axis: .vertical)
            .lineLimit(1...5)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(Color(.card), in: .rect(cornerRadius: 22, style: .continuous))
          if store.isRunning {
            Button("Stoppa", systemImage: "stop.fill") { Task { await store.stop() } }
              .buttonStyle(.round)
          } else {
            Button("Skicka", systemImage: "arrow.up") { send() }
              .buttonStyle(.round)
              .disabled(isSending || trimmedDraft.isEmpty)
          }
        }
      }
      .padding(.horizontal)
      .padding(.vertical, 10)
    }
  }

  /// The person said yes: add the phone if there is none, install what is ready, or build first.
  private func answer(_ phone: DirectInstall) {
    if phone.phones > 0, phone.status == .ready, phone.fresh != false, let path = phone.path, let url = api.installURL(forPagePath: path) {
      openURL(url)
      return
    }
    isAsking = true
    errorText = nil
    Task {
      defer { isAsking = false }
      do throws(APIError) {
        if phone.phones == 0 {
          // The profile that hands over the phone's identifier can only be fetched in Safari.
          openURL(try await api.addPhoneURL())
        } else {
          installsWhenReady = true
          try await api.buildForPhone(store.id)
        }
      } catch {
        installsWhenReady = false
        errorText = Texts.apiError(error.code)
      }
    }
  }

  private func send() {
    let text = trimmedDraft
    isSending = true
    errorText = nil
    Task {
      defer { isSending = false }
      do throws(APIError) {
        try await store.send(text)
        draft = ""
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}

/// What the builder says, and what went wrong when something did. The steps it took on the way are
/// not shown: they are about how the app is made, which is nothing the person needs to follow.
private struct PartsView: View {
  private enum Block: Identifiable {
    case text(Int, String)
    case error(Int, String)

    var id: Int {
      switch self {
      case .text(let id, _), .error(let id, _): id
      }
    }
  }

  let parts: [Part]

  private var blocks: [Block] {
    var out: [Block] = []
    for part in parts {
      switch part {
      case .text(let text):
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { out.append(.text(out.count, trimmed)) }
      case .error(let code):
        out.append(.error(out.count, Texts.agentError(code)))
      case .step, .unknown:
        break
      }
    }
    return out
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(blocks) { block in
        switch block {
        case .text(_, let text):
          Text(Self.styled(text))
            .padding(.horizontal, 15)
            .padding(.vertical, 10)
            .background(Color(.card), in: .rect(topLeadingRadius: 20, bottomLeadingRadius: 6, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous))
            .padding(.trailing, 28)
        case .error(_, let text):
          Text(text)
            .font(.footnote)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.brand.opacity(0.14), in: .rect(cornerRadius: 16, style: .continuous))
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// Bold and italics are shown as such, should the builder use them; nothing is shown as raw marks.
  private static func styled(_ text: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
  }
}

/// The wait, with clues: what is being done right now in plain words, a line that takes turns under
/// it, a bar that grows, and how much has been made so far.
private struct ProgressCard: View {
  let title: String
  let lines: [String]
  let fraction: Double
  var pieces = 0
  let startedAt: Date?

  /// While the builder works on the app.
  init(progress: RunProgress, startedAt: Date?) {
    title = Texts.runPhase(progress.phase)
    lines = switch progress.phase {
    case .trying, .looking, .fixing: WaitingLines.trying
    case .thinking, .making, .drawing: WaitingLines.working
    }
    fraction = progress.fraction
    pieces = progress.pieces
    self.startedAt = startedAt
  }

  /// While the finished app is made ready for the person's own phone.
  init(phone: DirectInstall, startedAt: Date?) {
    title = phone.stage == "signing" ? String(localized: "Signerar för din telefon") : String(localized: "Gör appen klar för din telefon")
    lines = WaitingLines.phone
    fraction = phone.progress ?? 0.05
    self.startedAt = startedAt
  }

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      MascotBadge(isDancing: true)
        .frame(width: 64)
      VStack(alignment: .leading, spacing: 6) {
        Text(title)
          .font(.headline)
          .contentTransition(.opacity)
        WaitingCaption(lines: lines)
          .font(.subheadline)
          .foregroundStyle(.secondary)
        ProgressView(value: fraction)
          .tint(.brand)
          .animation(.smooth(duration: 0.6), value: fraction)
          .padding(.top, 4)
          .accessibilityLabel("Hur långt det har kommit")
        HStack(spacing: 6) {
          if pieces > 0 { Text("Delar klara: \(pieces)") }
          if pieces > 0, startedAt != nil { Text(verbatim: "·") }
          if let startedAt { Text(startedAt, style: .timer).monospacedDigit() }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card()
    .animation(.smooth, value: title)
    .accessibilityElement(children: .combine)
  }
}

/// What comes after the wait, and the only thing that does: the builder's one sentence and the
/// question whether to put the app on the phone.
private struct InstallAsk: View {
  let words: String?
  let phone: DirectInstall
  /// True when the person's plan has no phone in it.
  var isLocked = false
  let isBusy: Bool
  let yes: () -> Void

  private var isArriving: Bool { phone.install == "asked" || phone.install == "fetching" }
  private var hasArrived: Bool { phone.status == .ready && phone.install == "fetched" }

  private var question: String {
    if isLocked { return String(localized: "Vill du ha den på din telefon? Det ingår i planen Skapa.") }
    if hasArrived { return String(localized: "Klart. Appen ligger på hemskärmen.") }
    if isArriving { return String(localized: "Hämtas till telefonen") }
    if phone.phones == 0 { return String(localized: "Vill du testa den på din telefon?") }
    return String(localized: "Vill du installera den på telefonen och testa?")
  }

  private var button: String {
    if isLocked { return String(localized: "Se planer") }
    if phone.phones == 0 { return String(localized: "Lägg till den här telefonen") }
    if phone.status == .failed { return String(localized: "Försök igen") }
    return hasArrived ? String(localized: "Installera igen") : String(localized: "Installera på telefonen")
  }

  var body: some View {
    VStack(spacing: 14) {
      Mascot(isCheering: isArriving)
        .frame(width: 96)
      if let words {
        Text(words)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      Text(question)
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
      if let progress = phone.progress, isArriving {
        ProgressView(value: progress)
          .tint(.brand)
          .animation(.smooth, value: progress)
      }
      if phone.status == .failed {
        Text(Texts.directError(phone.error))
          .font(.footnote)
          .foregroundStyle(.red)
          .multilineTextAlignment(.center)
      }
      if !isArriving {
        Button(button, action: yes)
          .buttonStyle(.bouncy)
          .disabled(isBusy)
      }
      if phone.phones == 0, !isLocked {
        Text("Du lägger till telefonen en gång. Sedan installeras varje app med ett tryck.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
    }
    .frame(maxWidth: .infinity)
    .card(padding: 22)
  }
}

private extension ChatMessage {
  /// The first sentence of what the builder said last in this answer, without the steps around it.
  var lastWords: String? {
    for part in parts.reversed() {
      if case .text(let text) = part {
        let sentence = text.firstSentence()
        if !sentence.isEmpty { return sentence }
      }
    }
    return nil
  }
}

