// The wait as a show: while the app is built, the whole screen is the mascot dancing and, in large
// words, what is being made right now.
import SwiftUI

struct BuildShow: View {
  enum Stage {
    /// The builder is at work.
    case building
    /// It has just finished, which is cheered for a moment.
    case done
    /// The finished app is being made ready for the person's own phone.
    case phone
  }

  let stage: Stage
  let progress: RunProgress
  /// What the builder has said it is making, oldest first.
  let said: [String]
  let phone: DirectInstall?
  let startedAt: Date?
  let showChat: () -> Void
  let stop: () -> Void

  /// The large words: what is being made right now, in the builder's own words once it has said something.
  private var headline: String {
    switch stage {
    case .building: said.last ?? Texts.runPhase(progress.phase)
    case .done: String(localized: "Klart!")
    case .phone: phone?.stage == "signing" ? String(localized: "Signerar för din telefon") : String(localized: "Gör appen klar för din telefon")
    }
  }

  private var lines: [String] {
    switch stage {
    case .building: WaitingLines.show(progress.phase)
    case .done: [String(localized: "Din app är färdig")]
    case .phone: WaitingLines.phone
    }
  }

  private var fraction: Double {
    switch stage {
    case .building: progress.fraction
    case .done: 1
    case .phone: phone?.progress ?? 0.05
    }
  }

  /// What was made before this, the latest first.
  private var earlier: [String] {
    guard stage == .building else { return [] }
    return Array(said.dropLast().suffix(3).reversed())
  }

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 8)
      Mascot(tile: .white, eyes: .brandDeep, isDancing: stage != .done, isCheering: stage == .done)
        .frame(maxWidth: 230)
        // The floor it dances on: a shadow under its feet.
        .background {
          GeometryReader { box in
            Ellipse()
              .fill(.black.opacity(0.13))
              .frame(width: box.size.width * 0.44, height: box.size.width * 0.05)
              .position(x: box.size.width / 2, y: box.size.height * 0.875)
          }
        }
      VStack(spacing: 12) {
        Text(headline)
          .font(.largeTitle.weight(.heavy))
          .multilineTextAlignment(.center)
          .lineLimit(3)
          .minimumScaleFactor(0.6)
          .frame(maxWidth: .infinity)
          .id(headline)
          .transition(.push(from: .bottom).combined(with: .opacity))
          .accessibilityAddTraits(.isHeader)
        WaitingCaption(lines: lines, every: 3.6)
          .font(.title3)
          .multilineTextAlignment(.center)
          .opacity(0.9)
          .frame(minHeight: 56, alignment: .top)
      }
      .animation(.bouncy(duration: 0.5), value: headline)
      .padding(.top, 14)

      VStack(spacing: 8) {
        Bar(fraction: fraction)
          .accessibilityLabel("Hur långt det har kommit")
          .accessibilityValue(Text(fraction, format: .percent.precision(.fractionLength(0))))
        HStack(spacing: 6) {
          if progress.pieces > 0 { Text("Delar klara: \(progress.pieces)") }
          if progress.pieces > 0, startedAt != nil { Text(verbatim: "·") }
          if let startedAt { Text(startedAt, style: .timer).monospacedDigit() }
        }
        .font(.footnote.weight(.medium))
        .opacity(0.85)
        .frame(minHeight: 18)
      }
      .padding(.top, 14)

      VStack(alignment: .leading, spacing: 8) {
        ForEach(earlier, id: \.self) { line in
          Label(line, systemImage: "checkmark.circle.fill")
            .lineLimit(1)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
      }
      .font(.subheadline)
      .opacity(0.8)
      .frame(maxWidth: .infinity, minHeight: 78, alignment: .top)
      .padding(.top, 18)
      .animation(.smooth(duration: 0.4), value: earlier)

      Spacer(minLength: 8)
      HStack(spacing: 10) {
        if stage == .building {
          Button("Stoppa", systemImage: "stop.fill", action: stop)
        }
        if stage != .done {
          Button("Visa chatten", systemImage: "bubble.left.and.bubble.right.fill", action: showChat)
        }
      }
      .buttonStyle(Pill())
      .frame(minHeight: 46)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, 26)
    .padding(.vertical, 18)
    .frame(maxWidth: 520)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background {
      ZStack {
        Rectangle().fill(.brandGradient)
        FloatingTiles()
      }
      .ignoresSafeArea()
    }
    // Read out as it changes, for the person who listens instead of looking.
    .onChange(of: headline) { _, now in
      AccessibilityNotification.Announcement(now).post()
    }
  }

  /// How far it has come: a white bar that grows on the orange.
  private struct Bar: View {
    let fraction: Double

    var body: some View {
      Capsule()
        .fill(.white.opacity(0.25))
        .frame(height: 10)
        .overlay(alignment: .leading) {
          GeometryReader { box in
            Capsule()
              .fill(.white)
              .frame(width: max(10, box.size.width * min(1, max(0, fraction))))
              .animation(.smooth(duration: 0.6), value: fraction)
          }
        }
    }
  }

  /// A quiet button on the orange: the show is the thing to look at, not the way out of it.
  private struct Pill: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
      configuration.label
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 18)
        .frame(minHeight: 46)
        .background(.white.opacity(0.2), in: .capsule)
        .scaleEffect(configuration.isPressed ? 0.94 : 1)
        .animation(.bouncy(duration: 0.3), value: configuration.isPressed)
    }
  }
}

/// App tiles drifting up behind the mascot, like bubbles in a glass.
private struct FloatingTiles: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
      Canvas { context, size in
        let time = timeline.date.timeIntervalSinceReferenceDate
        for tile in 0..<14 {
          // Made up from the tile's number alone, so every frame agrees on what each tile is like.
          let side = 26 + Confetti.noise(tile, 1) * 46
          let speed = 0.018 + Confetti.noise(tile, 2) * 0.03
          let risen = (Confetti.noise(tile, 3) + time * speed).truncatingRemainder(dividingBy: 1)
          let x = Confetti.noise(tile, 4) * size.width + sin(time * 0.5 + Double(tile)) * 14
          let y = size.height + side - risen * (size.height + side * 2)
          var bit = context
          bit.opacity = 0.07 + Confetti.noise(tile, 5) * 0.09
          bit.translateBy(x: x, y: y)
          bit.rotate(by: .degrees(sin(time * 0.3 + Double(tile)) * 18))
          let shape = CGRect(x: -side / 2, y: -side / 2, width: side, height: side)
          bit.fill(Path(roundedRect: shape, cornerRadius: side * 0.28, style: .continuous), with: .color(.white))
        }
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

#Preview {
  BuildShow(
    stage: .building,
    progress: RunProgress(parts: []),
    said: ["Väljer färger", "Nu gör jag listan med dina växter"],
    phone: nil,
    startedAt: .now,
    showChat: {},
    stop: {}
  )
}
