// The simulator preview: shows the streamed screen and forwards taps, swipes and typing to it.
import SwiftUI

struct PhoneView: View {
  let store: ProjectStore
  let api: API

  @State private var typed = ""
  /// What saving the screen as an App Store picture led to, shown for a moment.
  @State private var captureNote: (text: String, failed: Bool)?
  @State private var isCapturing = false
  @State private var touchStart: Date?

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
          Button("Spara som App Store-bild", systemImage: "camera") { capture() }
            .disabled(isCapturing)
        }
        .labelStyle(.iconOnly)
        .padding(.horizontal)
        if let captureNote {
          Text(captureNote.text)
            .font(.footnote)
            .foregroundStyle(captureNote.failed ? .red : .secondary)
            .padding(.horizontal)
        }
      } else if store.preview.status == .running {
        Text("Endast visning: tryck och text skickas inte till simulatorn just nu.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .padding(.horizontal)
      }
    }
    .padding(.vertical, 8)
  }

  @ViewBuilder
  private var screen: some View {
    if let frame = store.frame {
      Image(uiImage: frame)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .clipShape(.rect(cornerRadius: 28))
        .overlay { RoundedRectangle(cornerRadius: 28).stroke(.quaternary) }
        .overlay {
          GeometryReader { proxy in
            Color.clear
              .contentShape(.rect)
              .gesture(touches(in: proxy.size))
          }
        }
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
          }
        }
        .accessibilityLabel("Appens skärm i simulatorn")
    } else {
      placeholder
    }
  }

  @ViewBuilder
  private var placeholder: some View {
    switch store.preview.status {
    case .building:
      MascotNote(title: Text(Texts.buildStage(store.preview.stage)), isDancing: true)
    case .unavailable:
      MascotNote(
        title: Text("Ingen simulator är tillgänglig just nu"),
        message: Text("Din app sparas. Förhandsvisningen startar när en byggserver är ansluten.")
      )
    case .failed:
      MascotNote(title: Text("Den senaste ändringen gick inte att bygga")) {
        Button("Försök igen") { store.startPreview() }
          .buttonStyle(.bouncy)
      }
    case .idle:
      MascotNote(title: Text("Simulatorn är pausad")) {
        Button("Starta") { store.startPreview() }
          .buttonStyle(.bouncy)
          .disabled(store.isRunning)
      }
    case .running:
      // Frames are on their way.
      MascotNote(title: Text("Startar appen"), isDancing: true)
    }
  }

  /// One gesture tells taps from swipes: a short, still touch is a tap.
  private func touches(in size: CGSize) -> some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { _ in
        if touchStart == nil { touchStart = .now }
      }
      .onEnded { value in
        defer { touchStart = nil }
        guard canInput, size.width > 0, size.height > 0 else { return }
        func unit(_ point: CGPoint) -> (x: Double, y: Double) {
          (min(max(point.x / size.width, 0), 1), min(max(point.y / size.height, 0), 1))
        }
        let from = unit(value.startLocation)
        let to = unit(value.location)
        let moved = hypot(value.translation.width, value.translation.height)
        if moved < 10 {
          store.input(.tap(x: from.x, y: from.y))
        } else {
          let elapsed = Date.now.timeIntervalSince(touchStart ?? .now)
          let durationMs = min(max(Int(elapsed * 1000), 50), 3000)
          store.input(.swipe(x1: from.x, y1: from.y, x2: to.x, y2: to.y, durationMs: durationMs))
        }
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
