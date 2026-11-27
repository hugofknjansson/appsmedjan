// The simulator preview: shows the streamed screen and forwards taps, swipes and typing to it.
import SwiftUI

struct PhoneView: View {
  let store: ProjectStore
  let api: API
  /// Shows the app over the whole screen, to try it as if it were installed.
  let tryNow: () -> Void

  @State private var typed = ""
  /// What saving the screen as an App Store picture led to, shown for a moment.
  @State private var captureNote: (text: String, failed: Bool)?
  @State private var isCapturing = false

  private var canInput: Bool { store.preview.canInput && store.preview.status == .running }

  var body: some View {
    VStack(spacing: 12) {
      screen
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal)

      if canInput {
        HStack {
          TextField("Skriv i appen", text: $typed)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Color(.card), in: .capsule)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(sendTyped)
          Button("Radera", systemImage: "delete.left") { store.input(.key(.backspace)) }
          Button("Retur", systemImage: "return") { store.input(.key(.enter)) }
          Button("Hem", systemImage: "house") { store.input(.home) }
          Button("Prova i helskärm", systemImage: "arrow.up.left.and.arrow.down.right", action: tryNow)
          Button("Spara som App Store-bild", systemImage: "camera") { capture() }
            .disabled(isCapturing)
        }
        .labelStyle(.iconOnly)
        .padding(.horizontal)
        if isCapturing {
          HStack(spacing: 8) {
            BusyMark(size: 24)
            Text("Sparar bilden")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
          .padding(.horizontal)
        } else if let captureNote {
          Text(captureNote.text)
            .font(.footnote)
            .foregroundStyle(captureNote.failed ? .red : .secondary)
            .padding(.horizontal)
        }
      } else if store.preview.status == .running {
        Text("Endast visning: tryck och text skickas inte till appen just nu.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .padding(.horizontal)
      }
    }
    .padding(.vertical, 8)
  }

  @ViewBuilder
  private var screen: some View {
    if store.hasPicture {
      LiveScreen(store: store)
        .clipShape(.rect(cornerRadius: 28))
        .overlay { RoundedRectangle(cornerRadius: 28).stroke(.quaternary).allowsHitTesting(false) }
        .overlay(alignment: .top) {
          if store.preview.status == .building {
            HStack(spacing: 8) {
              MascotBadge(isDancing: true)
                .frame(width: 26)
              Text(Texts.buildStage(store.preview.stage))
            }
            .font(.footnote.weight(.semibold))
            .padding(.leading, 6)
            .padding(.trailing, 12)
            .padding(.vertical, 6)
            .background(.regularMaterial, in: .capsule)
            .padding(.top, 12)
            .allowsHitTesting(false)
          }
        }
    } else {
      PreviewPlaceholder(store: store)
    }
  }

  /// Saves what the simulator shows right now as a screenshot for the App Store page.
  private func capture() {
    isCapturing = true
    Task {
      defer { isCapturing = false }
      do throws(APIError) {
        let state = try await api.captureScreenshot(store.id)
        captureNote = (String(localized: "Sparad som App Store-bild (\(state.screenshots.count) av 10)."), false)
      } catch {
        captureNote = (Texts.apiError(error.code), true)
      }
    }
  }

  private func sendTyped() {
    guard !typed.isEmpty else { return }
    store.input(.text(typed))
    typed = ""
  }
}
