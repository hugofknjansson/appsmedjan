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
      case .chat: ChatView(store: store)
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

  @State private var draft = ""
  @State private var isSending = false
  @State private var errorText: String?

  private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          ForEach(store.messages) { message in
            switch message.role {
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
            WorkingShow(isTrying: store.liveParts.isTryingOut)
          }
        }
        .padding()
      }
      // Follows new content, like a chat should.
      .defaultScrollAnchor(.bottom)
      .scrollDismissesKeyboard(.interactively)

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

/// The wait while the builder works: the mascot dancing through its moves, with lines that take turns.
private struct WorkingShow: View {
  /// True while the builder is trying the app out rather than changing it.
  let isTrying: Bool

  var body: some View {
    HStack(spacing: 14) {
      MascotBadge(isDancing: true)
        .frame(width: 64)
      WaitingCaption(lines: isTrying ? WaitingLines.trying : WaitingLines.working)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 6)
    .accessibilityElement(children: .combine)
  }
}

private extension [Part] {
  /// True when the latest thing the builder started is trying the app out or looking at it.
  var isTryingOut: Bool {
    for part in reversed() {
      if case .step(let step) = part, step.status == .running { return step.kind == .build || step.kind == .look }
    }
    return false
  }
}
