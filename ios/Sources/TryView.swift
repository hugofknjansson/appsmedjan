// Trying the app: the simulator's screen over the whole of the phone's own, so that the app looks
// and answers to the touch as if it were installed. The only thing that is not the app is a small
// knob to get back with, which can be moved out of the way.
import SwiftUI

struct TryView: View {
  let store: ProjectStore
  /// Goes to where the app is put on the person's own phone, or to the way there.
  let install: () -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isShowingMenu = false
  /// Where the knob has been moved to, as a share of the screen; it starts at the trailing edge.
  @State private var knob = UnitPoint(x: 1, y: 0.62)
  @State private var knobStart: UnitPoint?
  @State private var showsHint = true

  var body: some View {
    ZStack {
      if store.hasPicture {
        // The whole of the phone's screen, edge to edge; the picture is fitted in the middle of it,
        // and fills it when the simulator is the same model as the phone.
        GeometryReader { proxy in
          LiveScreen(store: store)
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(.black)
        .ignoresSafeArea()
      } else {
        Color(.paper).ignoresSafeArea()
        PreviewPlaceholder(store: store)
      }
    }
    .overlay { GeometryReader { proxy in knobView(in: proxy.size) } }
    .overlay(alignment: .bottom) {
      if showsHint, store.hasPicture {
        Text("Det här är din app. Tryck på figuren för att gå tillbaka.")
          .font(.footnote.weight(.semibold))
          .multilineTextAlignment(.center)
          .padding(.horizontal, 16)
          .padding(.vertical, 10)
          .background(.regularMaterial, in: .capsule)
          .padding(.bottom, 28)
          .padding(.horizontal, 24)
          .transition(.opacity)
          .allowsHitTesting(false)
      }
    }
    // Nothing of the phone's own on top of the app: it has a status bar and a home indicator of its own.
    .statusBarHidden()
    .persistentSystemOverlays(.hidden)
    .confirmationDialog("", isPresented: $isShowingMenu) {
      Button("Tillbaka till chatten") { dismiss() }
      Button("Gå till appens startskärm") { store.input(.home) }
      Button("Få appen till din telefon") {
        dismiss()
        install()
      }
      Button("Avbryt", role: .cancel) {}
    }
    .task {
      // The hint is for the first few seconds; after that the app has the screen to itself.
      try? await Task.sleep(for: .seconds(5))
      withAnimation(reduceMotion ? nil : .smooth) { showsHint = false }
    }
  }

  /// The way back: the mascot in a small round badge, which can be dragged to where it is not in the way.
  private func knobView(in size: CGSize) -> some View {
    let side: CGFloat = 46
    let x = min(max(knob.x * size.width, side / 2 + 6), size.width - side / 2 - 6)
    let y = min(max(knob.y * size.height, side / 2 + 6), size.height - side / 2 - 6)
    return Mascot(tile: .white, eyes: .brandDeep)
      .padding(5)
      .frame(width: side, height: side)
      .background(.brandGradient, in: .circle)
      .overlay { Circle().stroke(.white.opacity(0.7), lineWidth: 1.5) }
      .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
      .opacity(0.92)
      .contentShape(.circle)
      .position(x: x, y: y)
      .gesture(
        DragGesture(minimumDistance: 6)
          .onChanged { value in
            let start = knobStart ?? knob
            knobStart = start
            guard size.width > 0, size.height > 0 else { return }
            knob = UnitPoint(x: start.x + value.translation.width / size.width, y: start.y + value.translation.height / size.height)
          }
          .onEnded { _ in
            knobStart = nil
            // It rests at the nearer edge, where it covers the least of the app.
            withAnimation(reduceMotion ? nil : .bouncy(duration: 0.35)) {
              knob = UnitPoint(x: knob.x < 0.5 ? 0 : 1, y: min(max(knob.y, 0), 1))
            }
          }
      )
      .onTapGesture { isShowingMenu = true }
      .accessibilityElement()
      .accessibilityLabel("Meny")
      .accessibilityHint("Går tillbaka till chatten, eller till appens startskärm")
      .accessibilityAddTraits(.isButton)
  }
}
