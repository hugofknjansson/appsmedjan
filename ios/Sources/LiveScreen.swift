// The simulator's screen as it arrives, with the touches on it sent back; and what is shown in its
// place while there is no screen to see.
import SwiftUI

/// The streamed screen, as video or as a still picture, in its own proportions. A finger on it is
/// sent to the simulator as it moves, so that what is under it there follows it.
struct LiveScreen: View {
  let store: ProjectStore

  /// The finger that is down: when it was last sent to the simulator, and where it was then. Nil when none is down.
  @State private var finger: (sentAt: Date, x: Double, y: Double)?

  private var canInput: Bool { store.preview.canInput && store.preview.status == .running }

  var body: some View {
    picture
      .overlay {
        GeometryReader { proxy in
          Color.clear
            .contentShape(.rect)
            .gesture(touches(in: proxy.size))
        }
      }
      .onDisappear(perform: liftFinger)
      .accessibilityElement()
      .accessibilityLabel("Appens skärm i simulatorn")
  }

  @ViewBuilder
  private var picture: some View {
    if store.showsVideo, let size = store.video.size {
      VideoScreen(feed: store.video).aspectRatio(size, contentMode: .fit)
    } else if let frame = store.frame {
      Image(uiImage: frame).resizable().aspectRatio(contentMode: .fit)
    }
  }

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
}

/// What stands in for the screen while there is none: what the preview is doing, and a way to start it.
struct PreviewPlaceholder: View {
  let store: ProjectStore

  var body: some View {
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
}
