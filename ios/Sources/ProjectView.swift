import SwiftUI

struct ProjectView: View {
  private enum Pane: Hashable { case chat, preview }

  @State private var store: ProjectStore
  @State private var pane = Pane.chat
  @State private var isConfirmingUpload = false
  @State private var noteText: String?
  @Environment(\.dismiss) private var dismiss

  init(project: ProjectSummary, api: API) {
    _store = State(initialValue: ProjectStore(project: project, api: api))
  }

  var body: some View {
    VStack(spacing: 0) {
      Picker("Vy", selection: $pane) {
        Text("Chatt").tag(Pane.chat)
        Text("Förhandsvisning").tag(Pane.preview)
      }
      .pickerStyle(.segmented)
      .padding(.horizontal)
      .padding(.vertical, 8)

      if let note = noteText.map({ (text: $0, failed: true) }) ?? Texts.publishNote(store.publish) {
        Text(note.text)
          .font(.footnote)
          .foregroundStyle(note.failed ? .red : .primary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal)
          .padding(.vertical, 8)
          .background(note.failed ? Color.red.opacity(0.1) : Color.forge.opacity(0.12))
      }

      switch pane {
      case .chat: ChatView(store: store)
      case .preview: PhoneView(store: store)
      }
    }
    .navigationTitle(store.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if store.publish.status == .working {
          Text(Texts.publishStage(store.publish.stage))
            .font(.footnote)
            .foregroundStyle(.secondary)
        } else if store.publish.available {
          Button("Till TestFlight") { isConfirmingUpload = true }
            .disabled(store.isRunning)
        }
      }
    }
    .confirmationDialog("Skicka \(store.name) till TestFlight?", isPresented: $isConfirmingUpload, titleVisibility: .visible) {
      Button("Skicka") { upload() }
    } message: {
      Text(store.publish.account == .own
        ? "Appen laddas upp till ditt eget Apple-utvecklarkonto."
        : "Appen laddas upp till tjänstens Apple-utvecklarkonto.")
    }
    .alert("Appen hittades inte.", isPresented: .constant(store.isMissing)) {
      Button("Alla appar") { dismiss() }
    }
    // The connection lives exactly as long as this screen is open.
    .task { await store.run() }
  }

  private func upload() {
    noteText = nil
    Task {
      do throws(APIError) {
        try await store.sendToTestFlight()
      } catch {
        noteText = Texts.apiError(error.code)
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
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.forge.opacity(0.15), in: .rect(cornerRadius: 16))
                .frame(maxWidth: .infinity, alignment: .trailing)
            case .assistant:
              PartsView(parts: message.parts, isLive: false)
            }
          }
          if store.isRunning {
            PartsView(parts: store.liveParts, isLive: true)
            Label("Arbetar", systemImage: "hammer")
              .font(.footnote)
              .foregroundStyle(.secondary)
              .symbolEffect(.pulse)
          }
        }
        .padding()
      }
      // Follows new content, like a chat should.
      .defaultScrollAnchor(.bottom)

      Divider()
      VStack(alignment: .leading, spacing: 6) {
        if let errorText {
          Text(errorText).font(.footnote).foregroundStyle(.red)
        }
        HStack(alignment: .bottom) {
          TextField("Beskriv vad du vill ändra eller lägga till", text: $draft, axis: .vertical)
            .lineLimit(1...5)
            .textFieldStyle(.roundedBorder)
          if store.isRunning {
            Button("Stoppa") { Task { await store.stop() } }
          } else {
            Button("Skicka") { send() }
              .buttonStyle(.borderedProminent)
              .disabled(isSending || trimmedDraft.isEmpty)
          }
        }
      }
      .padding()
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
        case .error(_, let text):
          Text(text)
            .font(.footnote)
            .padding(10)
            .background(Color.forge.opacity(0.12), in: .rect(cornerRadius: 10))
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
          case .done: Image(systemName: "checkmark").foregroundStyle(.green)
          case .error: Image(systemName: "wrench.adjustable").foregroundStyle(.orange)
          }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
      }
    }
  }
}
