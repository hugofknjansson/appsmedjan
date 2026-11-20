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
      case .code: CodeView(store: store, api: api)
      }
    }
    .background(Color(.paper))
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
    .navigationDestination(for: SourceFile.self) { SourceFileView(file: $0) }
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
  case chat, preview, code

  var id: Self { self }

  /// The middle pane is the person's own phone when apps can be installed on it, otherwise the simulator.
  func title(isPhoneFirst: Bool) -> LocalizedStringKey {
    switch self {
    case .chat: "Chatt"
    case .preview: isPhoneFirst ? "Min telefon" : "Förhandsvisning"
    case .code: "Kod"
    }
  }

  var symbol: String {
    switch self {
    case .chat: "bubble.left.and.bubble.right.fill"
    case .preview: "iphone"
    case .code: "chevron.left.forwardslash.chevron.right"
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
              PartsView(parts: message.parts, isLive: false)
            }
          }
          if store.isRunning {
            PartsView(parts: store.liveParts, isLive: true)
            HStack(spacing: 10) {
              MascotBadge(isDancing: true)
                .frame(width: 38)
              Text("Dansar fram din app")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
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

/// Text, progress rows and errors in order; a run of steps becomes one list that folds away when done.
private struct PartsView: View {
  private enum Block: Identifiable {
    case text(Int, String)
    case steps(Int, [Step])
    case error(Int, String)

    var id: Int {
      switch self {
      case .text(let id, _), .steps(let id, _), .error(let id, _): id
      }
    }
  }

  let parts: [Part]
  let isLive: Bool

  private var blocks: [Block] {
    var out: [Block] = []
    for part in parts {
      switch part {
      case .text(let text):
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { out.append(.text(out.count, trimmed)) }
      case .error(let code):
        out.append(.error(out.count, Texts.agentError(code)))
      case .step(let step):
        if case .steps(let id, let steps) = out.last {
          out[out.count - 1] = .steps(id, steps + [step])
        } else {
          out.append(.steps(out.count, [step]))
        }
      case .unknown:
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
          Text(text)
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
        case .steps(_, let steps):
          // Finished work folds away so the conversation stays readable.
          if isLive || steps.count <= 2 {
            StepList(steps: steps)
          } else {
            DisclosureGroup("\(steps.count) steg") { StepList(steps: steps) }
              .font(.footnote)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct StepList: View {
  let steps: [Step]

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(steps) { step in
        Label {
          Text(Texts.step(step))
        } icon: {
          switch step.status {
          case .running: ProgressView().controlSize(.mini)
          case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
          case .error: Image(systemName: "wrench.adjustable").foregroundStyle(.orange)
          }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
      }
    }
  }
}
