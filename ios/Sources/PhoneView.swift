// The simulator preview: shows the streamed screen and forwards taps, swipes and typing to it.
import SwiftUI

struct PhoneView: View {
  let store: ProjectStore
  let api: API

  @State private var typed = ""
  /// What saving the screen as an App Store picture led to, shown for a moment.
  @State private var captureNote: (text: String, failed: Bool)?
  @State private var isCapturing = false
  /// The finger that is down: when it was last sent to the simulator, and where it was then. Nil when none is down.
  @State private var finger: (sentAt: Date, x: Double, y: Double)?

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
    .onDisappear(perform: liftFinger)
  }

  @ViewBuilder
  private var screen: some View {
    if store.showsVideo, let size = store.video.size {
      framed(VideoScreen(feed: store.video).aspectRatio(size, contentMode: .fit))
    } else if let frame = store.frame {
      framed(Image(uiImage: frame).resizable().aspectRatio(contentMode: .fit))
    } else {
      placeholder
    }
  }

  /// The simulator's screen, as video or as a still picture, with its round corners, the touches
  /// on it and the note about a build in progress.
  private func framed(_ picture: some View) -> some View {
    picture
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
      .accessibilityElement()
      .accessibilityLabel("Appens skärm i simulatorn")
  }

  @ViewBuilder
  private var placeholder: some View {
    switch store.preview.status {
    case .building:
      MascotNote(title: Text(Texts.buildStage(store.preview.stage)), isDancing: true) {
        WaitingCaption(lines: WaitingLines.starting)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
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
      MascotNote(title: Text("Startar appen"), isDancing: true) {
        WaitingCaption(lines: WaitingLines.starting)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
  }

  /// The finger is sent as it moves, so that what is under it in the simulator follows it.
  private func touches(in size: CGSize) -> some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { value in
        guard canInput, size.width > 0, size.height > 0 else { return }
        let now = Date.now
        let x = unit(value.location.x, of: size.width), y = unit(value.location.y, of: size.height)
        guard let last = finger else {
          finger = (now, x, y)
          store.input(.touch(.down, x: unit(value.startLocation.x, of: size.width), y: unit(value.startLocation.y, of: size.height)))
          return
        }
        // No more often than the screen is drawn; where the finger lifts is always sent.
        guard now.timeIntervalSince(last.sentAt) >= 1.0 / 60 else { return }
        finger = (now, x, y)
        store.input(.touch(.move, x: x, y: y))
      }
      .onEnded { value in
        guard finger != nil else { return }
        finger = nil
        store.input(.touch(.up, x: unit(value.location.x, of: size.width), y: unit(value.location.y, of: size.height)))
      }
  }

  /// A finger that never got to lift, because the screen went away under it, is lifted where it was.
  private func liftFinger() {
    guard let last = finger else { return }
    finger = nil
    store.input(.touch(.up, x: last.x, y: last.y))
  }

  /// A place on the screen as a share of its width or height, between 0 and 1.
  private func unit(_ place: CGFloat, of length: CGFloat) -> Double {
    min(max(place / length, 0), 1)
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
