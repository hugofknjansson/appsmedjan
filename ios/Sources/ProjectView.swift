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
  /// The show that fills the screen while the app is built; nil when there is none to see.
  @State private var show: BuildShow.Stage?
  /// False once the person has chosen the chat over the show, until the next time something is built.
  @State private var watchesShow = true
  /// When the builder started on what it is doing now, for the clock beside the clues.
  @State private var runStartedAt: Date?

  private var isShowUp: Bool { show != nil && watchesShow }
  /// True while the app is tried over the whole screen, as if it were installed.
  @State private var isTrying = false

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
      case .chat: ChatView(store: store, api: api, runStartedAt: runStartedAt, showBuild: { watchesShow = true }, tryNow: { isTrying = true })
      case .preview:
        if let phone, !showsSimulator {
          PhoneTestView(store: store, api: api, direct: phone, showSimulator: { showsSimulator = true }, tryNow: { isTrying = true })
        } else {
          if phone != nil {
            Button("Tillbaka till min telefon", systemImage: "chevron.left") { showsSimulator = false }
              .font(.footnote.weight(.semibold))
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal)
          }
          PhoneView(store: store, api: api) { isTrying = true }
        }
      }
    }
    .background(Color(.paper))
    .accessibilityHidden(isShowUp)
    // While the app is built, the wait is a show that takes the whole screen.
    .overlay {
      if let show, watchesShow {
        BuildShow(
          stage: show,
          progress: RunProgress(parts: store.liveParts),
          said: store.liveParts.said,
          startedAt: runStartedAt,
          showChat: { watchesShow = false },
          stop: { Task { await store.stop() } }
        )
        .transition(.opacity.combined(with: .scale(scale: 1.04)))
      }
    }
    .animation(.smooth(duration: 0.4), value: isShowUp)
    .toolbar(isShowUp ? .hidden : .visible, for: .navigationBar)
    // Something to cheer about: the builder has finished, or the app has arrived on the phone.
    .overlay { Confetti(trigger: cheers) }
    .sensoryFeedback(.success, trigger: cheers)
    .onChange(of: store.isRunning, initial: true) { was, running in
      if running {
        runStartedAt = runStartedAt ?? .now
        if show != .building {
          show = .building
          watchesShow = true
          // The keyboard steps aside for the show, whichever field it was up for.
          UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
      } else {
        runStartedAt = nil
        if store.lastRunFailed || !was {
          show = nil
        } else {
          cheers += 1
          show = .done
        }
      }
    }
    // The cheer lasts a moment. Then the app itself takes the screen, to be tried at once, for the
    // person who watched it being built; whoever chose the chat stays there.
    .task(id: show) {
      guard show == .done else { return }
      try? await Task.sleep(for: .seconds(1.8))
      guard !Task.isCancelled, show == .done else { return }
      show = nil
      if watchesShow, store.preview.status != .unavailable { isTrying = true }
    }
    .fullScreenCover(isPresented: $isTrying) {
      TryView(store: store, install: phone == nil ? nil : {
        // Where the app is put on the person's own phone.
        showsSimulator = false
        pane = .preview
      })
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
  /// When the builder started on what it is doing now, for the clock beside the clues.
  let runStartedAt: Date?
  /// Brings back the show that fills the screen while the app is built.
  let showBuild: () -> Void
  /// Shows the app over the whole screen, to try it as if it were installed.
  let tryNow: () -> Void

  @Environment(\.openURL) private var openURL
  @State private var draft = ""
  @State private var isSending = false
  @State private var errorText: String?
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

  /// After the wait, one card: a way to try the app at once, and the question whether to put it on
  /// the phone where that can be done. The builder's last words go into that card instead of a
  /// bubble of their own.
  private var asked: ChatMessage? {
    guard !store.isRunning, !store.lastRunFailed, let last = store.messages.last, last.role == .assistant else { return nil }
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
            Button(action: showBuild) {
              ProgressCard(progress: RunProgress(parts: store.liveParts), said: store.liveParts.said.last, startedAt: runStartedAt)
            }
            .buttonStyle(.pop)
            .accessibilityHint("Visar bygget över hela skärmen")
          } else if let asked {
            AfterBuild(
              words: asked.lastWords,
              canTry: store.preview.status != .unavailable,
              tryNow: tryNow,
              phone: phone,
              isLocked: isLocked,
              isBusy: !isLocked && (isAsking || phone.map { !$0.available && $0.status != .ready } ?? false)
            ) {
              if isLocked { isShowingPlan = true } else if let phone { answer(phone) }
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
  init(progress: RunProgress, said: String?, startedAt: Date?) {
    title = said ?? Texts.runPhase(progress.phase)
    lines = switch progress.phase {
    case .trying, .looking, .fixing: WaitingLines.trying
    case .thinking, .making, .drawing: WaitingLines.working
    }
    fraction = progress.fraction
    pieces = progress.pieces
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

/// What comes after the wait, and the only thing that does: the builder's one sentence, a way to
/// try the app at once, and, where the person's own phone can take it, the question whether to put
/// it there.
private struct AfterBuild: View {
  let words: String?
  /// False when there is no simulator to try the app in right now.
  let canTry: Bool
  let tryNow: () -> Void
  /// The person's own phone, when apps can be installed straight onto it.
  let phone: DirectInstall?
  /// True when the person's plan has no phone in it.
  var isLocked = false
  let isBusy: Bool
  let install: () -> Void

  private var isArriving: Bool { phone?.install == "asked" || phone?.install == "fetching" }
  private var hasArrived: Bool { phone?.status == .ready && phone?.install == "fetched" }
  private var isGettingReady: Bool { phone?.status == .working }

  private var headline: String {
    if hasArrived { return String(localized: "Klart. Appen ligger på hemskärmen.") }
    if isArriving { return String(localized: "Hämtas till telefonen") }
    return String(localized: "Din app är klar att prova")
  }

  private var question: String {
    if isLocked { return String(localized: "Vill du ha den på din telefon? Det ingår i planen Skapa.") }
    if isGettingReady { return phone?.stage == "signing" ? String(localized: "Signerar för din telefon") : String(localized: "Gör appen klar för din telefon") }
    if phone?.phones == 0 { return String(localized: "Vill du ha den på din telefon också?") }
    return String(localized: "Vill du behålla den på telefonen?")
  }

  private var button: String {
    if isLocked { return String(localized: "Se planer") }
    if phone?.phones == 0 { return String(localized: "Lägg till den här telefonen") }
    if phone?.status == .failed { return String(localized: "Försök igen") }
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
      Text(headline)
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
      Button("Prova appen", action: tryNow)
        .buttonStyle(.bouncy)
        .disabled(!canTry)
      if let phone {
        VStack(spacing: 10) {
          if !hasArrived, !isArriving {
            Text(question)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
          }
          if let progress = phone.progress, isArriving || isGettingReady {
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
          if !isArriving, !isGettingReady {
            Button(button, action: install)
              .font(.subheadline.weight(.semibold))
              .disabled(isBusy)
          }
        }
        .padding(.top, 4)
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

