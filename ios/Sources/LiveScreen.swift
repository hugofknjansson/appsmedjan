// The simulator's screen as it arrives, with the touches on it sent back; and what is shown in its
// place while there is no screen to see.
import SwiftUI

/// The streamed screen, as video or as a still picture, in its own proportions. A finger on it is
/// sent to the simulator as it moves, so that what is under it there follows it (see Finger.swift).
struct LiveScreen: View {
  let store: ProjectStore

  private var canInput: Bool { store.preview.canInput && store.preview.status == .running }

  var body: some View {
    picture
      .overlay {
        // Sent where it is heading unless the server says to send it where it is.
        FingerSurface(isOn: canInput, looksAhead: store.preview.predictFinger ?? true) { store.input($0) }
      }
      .accessibilityElement()
      .accessibilityLabel("Appens skärm")
  }

  @ViewBuilder
  private var picture: some View {
    if store.showsVideo, let size = store.video.size {
      VideoScreen(feed: store.video).aspectRatio(size, contentMode: .fit)
    } else if let frame = store.frame {
      Image(uiImage: frame).resizable().aspectRatio(contentMode: .fit)
    }
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
        title: Text("Förhandsvisningen är upptagen just nu"),
        message: Text("Din app sparas. Förhandsvisningen startar så fort det finns plats.")
      )
    case .failed:
      MascotNote(title: Text("Den senaste ändringen gick inte att bygga")) {
        Button("Försök igen") { store.startPreview() }
          .buttonStyle(.bouncy)
      }
    case .idle:
      MascotNote(title: Text("Förhandsvisningen är pausad")) {
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
