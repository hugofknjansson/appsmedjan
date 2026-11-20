// What makes a wait worth watching: lines that take turns under the dancing mascot, and confetti
// when something has gone well.
import SwiftUI

/// What to say while something takes time. Each list is gone through in order, again and again.
enum WaitingLines {
  /// The builder is changing the app.
  static let working = [
    String(localized: "Dansar fram din app"),
    String(localized: "Snickrar på knapparna"),
    String(localized: "Väljer färger som passar"),
    String(localized: "Lär appen ett nytt steg"),
    String(localized: "Putsar på detaljerna"),
    String(localized: "Tar en piruett medan det blir klart"),
  ]
  /// The builder is trying the app out.
  static let trying = [
    String(localized: "Provkör appen"),
    String(localized: "Trycker på alla knappar"),
    String(localized: "Tittar hur det blev"),
  ]
  /// The preview is starting.
  static let starting = [
    String(localized: "Värmer upp"),
    String(localized: "Packar upp appen"),
    String(localized: "Snart ser du den"),
  ]
  /// The app is on its way onto the person's own phone.
  static let phone = [
    String(localized: "Det här tar ungefär en halv minut"),
    String(localized: "Gör plats på hemskärmen"),
    String(localized: "Knyter skorna inför premiären"),
    String(localized: "Snart är den din"),
  ]
}

/// One line at a time from a list, each pushing the last one out of the way.
struct WaitingCaption: View {
  let lines: [String]
  var every: Double = 3.2

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    if reduceMotion || lines.count < 2 {
      Text(lines.first ?? "")
    } else {
      TimelineView(.periodic(from: .now, by: every)) { timeline in
        Turn(line: lines[Int(timeline.date.timeIntervalSinceReferenceDate / every) % lines.count])
      }
    }
  }

  // A view of its own, so the change of line is something SwiftUI can animate.
  private struct Turn: View {
    let line: String

    var body: some View {
      Text(line)
        .id(line)
        .transition(.push(from: .bottom).combined(with: .opacity))
        .animation(.bouncy(duration: 0.45), value: line)
    }
  }
}

/// A burst of confetti from the middle of the top, once every time `trigger` changes.
struct Confetti: View {
  let trigger: Int

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var startedAt: Date?

  private static let colors: [Color] = [.brandLight, .brand, .pink, .purple, .teal, .yellow, .green]
  private static let duration = 2.4

  var body: some View {
    TimelineView(.animation(paused: startedAt == nil)) { timeline in
      Canvas { context, size in
        guard let startedAt else { return }
        let time = timeline.date.timeIntervalSince(startedAt)
        guard time < Self.duration else { return }
        for piece in 0..<48 {
          // Made up from the piece's number alone, so every frame agrees on where each piece is.
          let spread = Self.noise(piece, 1) * 2 - 1
          let speed = 0.55 + Self.noise(piece, 2) * 0.6
          let x = size.width / 2 + spread * size.width * 0.55 * min(1, time * 1.6)
          let y = size.height * 0.18 - sin(min(time * 2.2, .pi / 2)) * size.height * 0.16 * speed + time * time * size.height * 0.2 * speed
          let side = 7 + Self.noise(piece, 3) * 7
          var bit = context
          bit.opacity = max(0, 1 - time / Self.duration)
          bit.translateBy(x: x, y: y)
          bit.rotate(by: .radians(time * (3 + Self.noise(piece, 4) * 6) * (spread < 0 ? -1 : 1)))
          let shape = CGRect(x: -side / 2, y: -side / 4, width: side, height: side / 2)
          bit.fill(Path(roundedRect: shape, cornerRadius: 1.5), with: .color(Self.colors[piece % Self.colors.count]))
        }
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .onChange(of: trigger) {
      guard !reduceMotion else { return }
      let now = Date.now
      startedAt = now
      Task {
        try? await Task.sleep(for: .seconds(Self.duration))
        // A newer burst may have started in the meantime.
        if startedAt == now { startedAt = nil }
      }
    }
  }

  /// A number between 0 and 1 that is always the same for the same piece and purpose.
  private static func noise(_ piece: Int, _ salt: Int) -> Double {
    let mixed = sin(Double(piece * 97 + salt * 131) * 12.9898) * 43758.5453
    return mixed - mixed.rounded(.down)
  }
}
