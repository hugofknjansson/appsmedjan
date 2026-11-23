// The machines that make an app, each with a job of its own: while an app is built they are on the
// screen side by side, and the person sees several of them at work on it at once.
import SwiftUI

/// One of the machines that make an app.
nonisolated enum Machine: CaseIterable, Identifiable {
  case planner, designer, coder, painter, builder, tester

  var id: Self { self }

  var name: String {
    switch self {
    case .planner: String(localized: "Planerare")
    case .designer: String(localized: "Formgivare")
    case .coder: String(localized: "Kodare")
    case .painter: String(localized: "Ikonritare")
    case .builder: String(localized: "Byggserver")
    case .tester: String(localized: "Testtelefon")
    }
  }

  /// What it does, in a word or two: for the introduction, where it is seen for a moment.
  var job: String {
    switch self {
    case .planner: String(localized: "Planerar")
    case .designer: String(localized: "Formger")
    case .coder: String(localized: "Kodar")
    case .painter: String(localized: "Ritar")
    case .builder: String(localized: "Bygger")
    case .tester: String(localized: "Provar")
    }
  }

  var symbol: String {
    switch self {
    case .planner: "lightbulb.fill"
    case .designer: "paintpalette.fill"
    case .coder: "chevron.left.forwardslash.chevron.right"
    case .painter: "paintbrush.pointed.fill"
    case .builder: "server.rack"
    case .tester: "iphone"
    }
  }

  var color: Color {
    switch self {
    case .planner: Color(red: 0.93, green: 0.62, blue: 0.05)
    case .designer: Color(red: 0.89, green: 0.27, blue: 0.47)
    case .coder: Color(red: 0.55, green: 0.36, blue: 0.87)
    case .painter: Color(red: 0.16, green: 0.60, blue: 0.62)
    case .builder: Color(red: 0.22, green: 0.50, blue: 0.90)
    case .tester: Color(red: 0.31, green: 0.65, blue: 0.33)
    }
  }

  /// What it is doing while it works.
  func doing(pieces: Int) -> String {
    switch self {
    case .planner: String(localized: "Läser din idé")
    case .designer: String(localized: "Väljer färger och former")
    case .coder: pieces == 0 ? String(localized: "Skriver koden") : pieces == 1 ? String(localized: "1 del skriven") : String(localized: "\(pieces) delar skrivna")
    case .painter: String(localized: "Ritar ikonen")
    case .builder: String(localized: "Bygger appen på en Mac")
    case .tester: String(localized: "Trycker på knapparna")
    }
  }

  nonisolated enum State: Equatable { case waiting, working, done }

  /// Where each machine is, read off how far the builder has come. More than one works at a time:
  /// the look is chosen while the code is written, and the app is tried while it is built.
  static func states(_ progress: RunProgress, isDone: Bool) -> [Machine: State] {
    guard !isDone else { return Dictionary(uniqueKeysWithValues: allCases.map { ($0, .done) }) }
    let phase = progress.phase
    let tried = progress.tries > 0
    let coder: State = switch phase {
    case .thinking: .waiting
    case .making, .fixing, .drawing: .working
    case .trying, .looking: .done
    }
    return [
      .planner: phase == .thinking ? .working : .done,
      .designer: phase == .thinking || phase == .making || phase == .drawing ? .working : .done,
      .coder: coder,
      .painter: progress.hasIcon ? .done : phase == .drawing ? .working : .waiting,
      .builder: phase == .trying ? .working : tried ? .done : .waiting,
      .tester: phase == .trying || phase == .looking ? .working : tried ? .done : .waiting,
    ]
  }
}

/// The machines at work on the app, in two rows on the orange. When the show opens they start up
/// one after the other, as a row of machines being switched on.
struct CrewBoard: View {
  let progress: RunProgress
  let isDone: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// How many of the machines have started; they start one at a time when the board appears.
  @State private var started = 0

  private var states: [Machine: Machine.State] { Machine.states(progress, isDone: isDone) }
  private var isStarting: Bool { started < Machine.allCases.count }

  private var heading: String {
    if isDone { return String(localized: "Alla maskiner är klara") }
    if isStarting { return String(localized: "Startar maskinerna …") }
    return String(localized: "\(Machine.allCases.count) maskiner arbetar med din app")
  }

  var body: some View {
    VStack(spacing: 10) {
      HStack(spacing: 8) {
        LiveDot(isOn: !isDone)
        Text(heading)
          .contentTransition(.opacity)
      }
      .font(.footnote.weight(.bold))
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(.white.opacity(0.18), in: .capsule)
      .animation(Motion.swap, value: heading)

      // One clock for every card, so that what turns and shines on them keeps in step.
      TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion || isDone)) { timeline in
        let time = timeline.date.timeIntervalSinceReferenceDate
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
          ForEach(Array(Machine.allCases.enumerated()), id: \.element) { index, machine in
            MachineCard(machine: machine, state: states[machine] ?? .waiting, pieces: progress.pieces, time: time + Double(index) * 0.37)
              .modifier(SwitchingOn(isOn: index < started, reduceMotion: reduceMotion))
          }
        }
      }
    }
    .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: started)
    .task {
      for count in 1...Machine.allCases.count {
        try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : count == 1 ? 350 : 140))
        guard !Task.isCancelled else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .spring(duration: 0.5, bounce: 0.3)) { started = count }
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// One machine: its tile, its name and what it is doing. One at work has a light running round its
/// edge and a shine going over its bar; one that is done has a tick.
private struct MachineCard: View {
  let machine: Machine
  let state: Machine.State
  let pieces: Int
  let time: TimeInterval

  private var status: String {
    switch state {
    case .waiting: String(localized: "Står redo")
    case .working: machine.doing(pieces: pieces)
    case .done: String(localized: "Klar")
    }
  }

  var body: some View {
    let isWorking = state == .working
    VStack(spacing: 6) {
      Image(systemName: machine.symbol)
        .font(.system(size: 16, weight: .bold))
        .foregroundStyle(machine.color)
        .symbolEffect(.pulse, isActive: isWorking)
        .frame(width: 36, height: 36)
        .background(.white, in: .rect(cornerRadius: 11, style: .continuous))
        // Busy: it rocks a little, the way a machine hums.
        .rotationEffect(.degrees(isWorking ? sin(time * 7) * 6 : 0))
        .overlay(alignment: .topTrailing) {
          if state == .done {
            Image(systemName: "checkmark.circle.fill")
              .font(.system(size: 15, weight: .bold))
              .symbolRenderingMode(.palette)
              .foregroundStyle(.white, Color(red: 0.2, green: 0.68, blue: 0.35))
              .background(.white, in: .circle)
              .offset(x: 6, y: -6)
              .transition(.scale(scale: 0.3).combined(with: .opacity))
          }
        }
      Text(machine.name)
        .font(.caption.weight(.heavy))
        .lineLimit(1)
        .minimumScaleFactor(0.75)
      Text(status)
        .font(.caption2.weight(.medium))
        .opacity(0.88)
        .multilineTextAlignment(.center)
        .lineLimit(2, reservesSpace: true)
        .minimumScaleFactor(0.8)
        .contentTransition(.opacity)
      Shine(isOn: isWorking, time: time)
    }
    .padding(.horizontal, 6)
    .padding(.top, 10)
    .padding(.bottom, 8)
    .frame(maxWidth: .infinity)
    .background(.white.opacity(isWorking ? 0.26 : 0.14), in: .rect(cornerRadius: 18, style: .continuous))
    .overlay {
      if isWorking {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .strokeBorder(
            AngularGradient(colors: [.white, .white.opacity(0), .white.opacity(0), .white], center: .center, angle: .degrees(time * 160)),
            lineWidth: 2
          )
          .transition(.opacity)
      }
    }
    .opacity(state == .waiting ? 0.62 : 1)
    .scaleEffect(isWorking ? 1 : 0.97)
    .animation(.spring(duration: 0.5, bounce: 0.35), value: state)
  }
}

/// A thin bar with a light going across it, again and again, while a machine works.
private struct Shine: View {
  let isOn: Bool
  let time: TimeInterval

  var body: some View {
    Capsule()
      .fill(.white.opacity(0.22))
      .frame(height: 3)
      .overlay {
        GeometryReader { box in
          let across = (time * 0.9).truncatingRemainder(dividingBy: 1)
          Capsule()
            .fill(.white)
            .frame(width: box.size.width * 0.35)
            .offset(x: (across * 1.35 - 0.35) * box.size.width)
        }
        .clipShape(.capsule)
        .opacity(isOn ? 1 : 0)
      }
      .padding(.horizontal, 8)
  }
}

/// A dot that beats like a light on a machine that is on.
private struct LiveDot: View {
  let isOn: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Circle()
      .fill(isOn ? Color(red: 0.45, green: 0.95, blue: 0.55) : .white)
      .frame(width: 8, height: 8)
      .phaseAnimator([false, true]) { dot, beat in
        dot
          .background {
            Circle()
              .fill(.white.opacity(beat || !isOn || reduceMotion ? 0 : 0.6))
              .scaleEffect(beat && isOn && !reduceMotion ? 2.6 : 1)
          }
      } animation: { beat in
        beat ? .easeOut(duration: 1.1) : nil
      }
  }
}

/// A machine being switched on: it turns up towards the person, out of a blur.
private struct SwitchingOn: ViewModifier {
  let isOn: Bool
  let reduceMotion: Bool

  func body(content: Content) -> some View {
    content
      .opacity(isOn ? 1 : 0)
      .scaleEffect(isOn || reduceMotion ? 1 : 0.8)
      .blur(radius: isOn || reduceMotion ? 0 : 6)
      .rotation3DEffect(.degrees(isOn || reduceMotion ? 0 : -70), axis: (x: 1, y: 0, z: 0), anchor: .bottom, perspective: 0.6)
  }
}
