// What App Dance does, shown before anyone is asked for an e-mail address: a short film that plays by
// itself. An idea is written, the machines build it into a phone, and the app is there to press.
import SwiftUI

struct IntroView: View {
  /// On to the form: true to make an account, false to sign in to one.
  let start: (_ isNew: Bool) -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// 0 while the idea is written, 1 while the app is built, 2 while it is tried.
  @State private var scene = 0
  /// How many times the film has gone round; each round is another idea.
  @State private var round = 0
  /// How much of the idea has been written.
  @State private var typed = 0
  /// How many parts of the app are in place on the phone.
  @State private var built = 0
  /// True once the finger has pressed the app.
  @State private var pressed = false
  /// How far the current scene has come, for the bar at the top.
  @State private var fill = 0.0
  @State private var cheers = 0

  private static let lengths = [3.4, 4.6, 3.6]
  private var example: IntroExample { IntroExample.all[round % IntroExample.all.count] }

  private var title: String {
    switch scene {
    case 0: String(localized: "Du beskriver din idé")
    case 1: String(localized: "Maskinerna bygger den")
    default: String(localized: "Du provar den direkt")
    }
  }

  private var subtitle: String {
    switch scene {
    case 0: String(localized: "Med egna ord, som i ett sms. Ingen kod.")
    case 1: String(localized: "Flera maskiner arbetar med din app samtidigt, medan du tittar på.")
    default: String(localized: "En riktig iPhone-app, färdig att trycka på.")
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      bars
        .padding(.horizontal, 24)
        .padding(.top, 8)

      IntroStage(example: example, scene: scene, typed: typed, built: built, pressed: pressed)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(.rect)
        .onTapGesture { advance() }
        .accessibilityHidden(true)

      VStack(spacing: 8) {
        Text(title)
          .font(.largeTitle.weight(.heavy))
          .id("title\(scene)")
          .transition(reduceMotion ? AnyTransition.opacity : AnyTransition(.blurReplace(.upUp)))
          .accessibilityAddTraits(.isHeader)
        Text(subtitle)
          .font(.callout.weight(.medium))
          .opacity(0.92)
          .frame(minHeight: 44, alignment: .top)
          .id("subtitle\(scene)")
          .transition(reduceMotion ? AnyTransition.opacity : AnyTransition(.blurReplace(.upUp)))
      }
      .multilineTextAlignment(.center)
      .lineLimit(2)
      .minimumScaleFactor(0.7)
      .padding(.horizontal, 24)
      .animation(.spring(duration: 0.5, bounce: 0.15), value: scene)

      VStack(spacing: 4) {
        Button("Kom igång") { start(true) }
          .buttonStyle(.bouncyInverted)
        Button("Jag har redan ett konto") { start(false) }
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.white)
          .frame(minHeight: 44)
      }
      .padding(.horizontal, 24)
      .padding(.top, 18)
      .padding(.bottom, 8)
    }
    .foregroundStyle(.white)
    .frame(maxWidth: 520)
    .frame(maxWidth: .infinity)
    .background {
      Rectangle().fill(.brandGradient).ignoresSafeArea()
    }
    .overlay { Confetti(trigger: cheers).allowsHitTesting(false) }
    .task(id: round * 10 + scene) { await play() }
  }

  /// One bar for each scene, as in a story: the one playing fills up as it goes.
  private var bars: some View {
    HStack(spacing: 6) {
      ForEach(0..<3, id: \.self) { index in
        Capsule()
          .fill(.white.opacity(0.3))
          .frame(height: 4)
          .overlay(alignment: .leading) {
            GeometryReader { box in
              Capsule()
                .fill(.white)
                .frame(width: box.size.width * (index < scene ? 1 : index == scene ? fill : 0))
            }
          }
      }
    }
    .accessibilityElement()
    .accessibilityLabel(Text("Steg \(scene + 1) av 3"))
  }

  /// Plays the scene through, then goes on to the next one.
  private func play() async {
    var instantly = Transaction()
    instantly.disablesAnimations = true
    withTransaction(instantly) { fill = 0 }
    withAnimation(.linear(duration: Self.lengths[scene])) { fill = 1 }
    let began = ContinuousClock.now

    switch scene {
    case 0:
      withTransaction(instantly) {
        built = 0
        pressed = false
        typed = 0
      }
      let letters = example.idea.count
      if reduceMotion {
        typed = letters
      } else {
        try? await Task.sleep(for: .milliseconds(350))
        // Written out in about one and a half seconds, however long the idea is.
        let step = max(1, letters / 45)
        while typed < letters {
          try? await Task.sleep(for: .milliseconds(32))
          if Task.isCancelled { return }
          typed = min(letters, typed + step)
        }
      }
    case 1:
      typed = example.idea.count
      try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 700))
      for part in 1...IntroPhone.parts {
        if Task.isCancelled { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .spring(duration: 0.5, bounce: 0.3)) { built = part }
        try? await Task.sleep(for: .milliseconds(480))
      }
    default:
      built = IntroPhone.parts
      try? await Task.sleep(for: .milliseconds(900))
      if Task.isCancelled { return }
      withAnimation(.spring(duration: 0.4, bounce: 0.4)) { pressed = true }
      cheers += 1
    }

    let left = Duration.seconds(Self.lengths[scene]) - (ContinuousClock.now - began)
    if left > .zero { try? await Task.sleep(for: left) }
    if Task.isCancelled { return }
    advance()
  }

  private func advance() {
    withAnimation(reduceMotion ? .easeOut(duration: 0.25) : .spring(duration: 0.7, bounce: 0.15)) {
      if scene == 2 {
        scene = 0
        round += 1
      } else {
        scene += 1
      }
    }
  }
}

/// An idea, and the app that is made of it.
private struct IntroExample {
  let idea: String
  let name: String
  let symbol: String
  let color: Color
  let rows: [String]

  static let all = [
    IntroExample(
      idea: String(localized: "En app som påminner mig att vattna blommorna"),
      name: String(localized: "Mina växter"), symbol: "leaf.fill", color: Color(red: 0.31, green: 0.65, blue: 0.33),
      rows: [String(localized: "Monstera"), String(localized: "Basilika"), String(localized: "Kaktusen")]
    ),
    IntroExample(
      idea: String(localized: "En poängräknare till spelkvällen"),
      name: String(localized: "Spelkväll"), symbol: "trophy.fill", color: Color(red: 0.55, green: 0.36, blue: 0.87),
      rows: [String(localized: "Anna  12"), String(localized: "Omar  9"), String(localized: "Lisa  7")]
    ),
    IntroExample(
      idea: String(localized: "En packlista som minns vad jag glömde sist"),
      name: String(localized: "Packlistan"), symbol: "suitcase.fill", color: Color(red: 0.22, green: 0.50, blue: 0.90),
      rows: [String(localized: "Laddaren"), String(localized: "Solkräm"), String(localized: "Passet")]
    ),
  ]
}

/// Where the film plays: the idea in a speech bubble, a phone, and the machines around it.
private struct IntroStage: View {
  let example: IntroExample
  let scene: Int
  let typed: Int
  let built: Int
  let pressed: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private static let phone = CGSize(width: 158, height: 316)

  var body: some View {
    GeometryReader { box in
      let middle = CGPoint(x: box.size.width / 2, y: box.size.height / 2)
      let places = machinePlaces(around: middle)
      // As large as the screen has room for: the phone takes most of the height, the machines fit beside it.
      let fit = min(box.size.height * 0.62 / Self.phone.height, (box.size.width / 2 - 6) / (Self.phone.width / 2 + 90), 1.3)
      ZStack {
        // What goes from each machine into the phone, while it is built.
        Wires(from: places, to: middle, phoneWidth: Self.phone.width)
          .opacity(scene == 1 ? 1 : 0)

        IntroPhone(example: example, built: built, pressed: pressed)
          .frame(width: Self.phone.width, height: Self.phone.height)
          // Empty and a little smaller while the idea is written above it.
          .scaleEffect(scene == 0 ? 0.82 : scene == 2 ? 1.08 : 1)
          .position(x: middle.x, y: middle.y + (scene == 0 ? 50 : 0))

        ForEach(Array(Machine.allCases.enumerated()), id: \.element) { index, machine in
          MachineBadge(machine: machine, isOn: scene == 1, order: index)
            .position(places[index])
        }

        bubble
          .frame(maxWidth: min(300, box.size.width - 48))
          // Written at the top; then it goes into the phone, which is where the idea ends up.
          .scaleEffect(scene == 0 ? 1 : 0.2)
          .opacity(scene == 0 ? 1 : 0)
          .position(x: middle.x, y: scene == 0 ? middle.y - Self.phone.height * 0.5 - 30 : middle.y)
      }
      .scaleEffect(fit)
    }
  }

  /// Three machines on each side of the phone.
  private func machinePlaces(around middle: CGPoint) -> [CGPoint] {
    let x = Self.phone.width / 2 + 52
    let ys: [CGFloat] = [-110, 0, 110]
    return ys.map { CGPoint(x: middle.x - x, y: middle.y + $0) } + ys.map { CGPoint(x: middle.x + x, y: middle.y + $0) }
  }

  private var bubble: some View {
    let letters = Array(example.idea)
    return HStack(alignment: .firstTextBaseline, spacing: 1) {
      Text(String(letters[..<min(typed, letters.count)]))
      // The place where the next letter goes, as long as there are letters to come.
      if typed < letters.count {
        Capsule()
          .fill(Color.brand)
          .frame(width: 2.5, height: 20)
          .phaseAnimator([1.0, 0.0]) { cursor, shown in cursor.opacity(shown) }
      }
    }
    .font(.title3.weight(.bold))
    .foregroundStyle(Color(red: 0.15, green: 0.1, blue: 0.08))
    .multilineTextAlignment(.leading)
    .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .background(.white, in: .rect(topLeadingRadius: 24, bottomLeadingRadius: 6, bottomTrailingRadius: 24, topTrailingRadius: 24, style: .continuous))
    .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
  }
}

/// A machine as a round badge with its job under it, next to the phone it works on.
private struct MachineBadge: View {
  let machine: Machine
  let isOn: Bool
  let order: Int

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 5) {
      Image(systemName: machine.symbol)
        .font(.system(size: 19, weight: .bold))
        .foregroundStyle(machine.color)
        .symbolEffect(.pulse, isActive: isOn)
        .frame(width: 50, height: 50)
        .background(.white, in: .circle)
        .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
      Text(machine.job)
        .font(.caption.weight(.heavy))
    }
    .opacity(isOn ? 1 : 0)
    .scaleEffect(isOn || reduceMotion ? 1 : 0.4)
    .blur(radius: isOn || reduceMotion ? 0 : 8)
    // They come up one after the other, and go all together.
    .animation(isOn ? .spring(duration: 0.55, bounce: 0.4).delay(0.08 * Double(order)) : .easeOut(duration: 0.2), value: isOn)
  }
}

/// Lines from the machines into the phone, with something on its way along each of them.
private struct Wires: View {
  let from: [CGPoint]
  let to: CGPoint
  let phoneWidth: CGFloat

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 60, paused: reduceMotion)) { timeline in
      Canvas { context, _ in
        let time = timeline.date.timeIntervalSinceReferenceDate
        for (index, start) in from.enumerated() {
          let side: CGFloat = start.x < to.x ? -1 : 1
          // From the edge of the machine's round badge, which sits a little above the middle of it and its name.
          let start = CGPoint(x: start.x - side * 30, y: start.y - 11)
          let end = CGPoint(x: to.x + side * (phoneWidth / 2 - 4), y: to.y + (start.y - to.y) * 0.35)
          var line = Path()
          line.move(to: start)
          line.addLine(to: end)
          context.stroke(line, with: .color(.white.opacity(0.35)), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [2, 7]))
          // Two parcels on each line, a little apart.
          for parcel in 0..<2 {
            let along = (time * 0.9 + Double(index) * 0.17 + Double(parcel) * 0.5).truncatingRemainder(dividingBy: 1)
            let place = CGPoint(x: start.x + (end.x - start.x) * along, y: start.y + (end.y - start.y) * along)
            let side = 7.0
            context.fill(
              Path(roundedRect: CGRect(x: place.x - side / 2, y: place.y - side / 2, width: side, height: side), cornerRadius: 2),
              with: .color(.white.opacity(sin(along * .pi)))
            )
          }
        }
      }
    }
    .allowsHitTesting(false)
  }
}

/// The app on a phone, put together part by part: its name at the top, three rows, and a button.
private struct IntroPhone: View {
  let example: IntroExample
  let built: Int
  let pressed: Bool

  /// How many parts the app is put together from.
  static let parts = 5

  private let ink = Color(red: 0.15, green: 0.1, blue: 0.08)

  var body: some View {
    RoundedRectangle(cornerRadius: 34, style: .continuous)
      .fill(Color(red: 0.1, green: 0.08, blue: 0.07))
      .overlay {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
          .fill(.white)
          .padding(6)
          .overlay(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
              Capsule().fill(.black).frame(width: 44, height: 13).frame(maxWidth: .infinity)
              if built >= 1 {
                HStack(spacing: 8) {
                  Image(systemName: example.symbol)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(example.color.gradient, in: .rect(cornerRadius: 8, style: .continuous))
                  Text(example.name)
                    .font(.system(size: 16, weight: .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                }
                .padding(.top, 10)
                .transition(.piece)
              }
              ForEach(Array(example.rows.enumerated()), id: \.offset) { index, row in
                if built >= index + 2 {
                  self.row(row, isTicked: index == 0 && pressed)
                    .transition(.piece)
                }
              }
              Spacer(minLength: 0)
              if built >= 5 {
                Text("+ Lägg till")
                  .font(.system(size: 13, weight: .bold))
                  .foregroundStyle(.white)
                  .frame(maxWidth: .infinity, minHeight: 34)
                  .background(example.color.gradient, in: .capsule)
                  .transition(.piece)
              }
            }
            .foregroundStyle(ink)
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 22)
            .frame(maxHeight: .infinity)
          }
      }
      // One shadow for the phone as a whole, not one for every part on its screen.
      .compositingGroup()
      .shadow(color: .black.opacity(0.25), radius: 24, y: 12)
  }

  private func row(_ text: String, isTicked: Bool) -> some View {
    HStack(spacing: 8) {
      ZStack {
        Circle().strokeBorder(example.color, lineWidth: 2)
        if isTicked {
          Circle().fill(example.color)
          Image(systemName: "checkmark")
            .font(.system(size: 9, weight: .heavy))
            .foregroundStyle(.white)
        }
      }
      .frame(width: 18, height: 18)
      Text(text)
        .font(.system(size: 13, weight: .semibold))
        .lineLimit(1)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 10)
    .frame(height: 36)
    .background(Color(red: 0.96, green: 0.94, blue: 0.92), in: .rect(cornerRadius: 10, style: .continuous))
    // The finger pressing the first row: a ring that spreads from where it lands.
    .overlay(alignment: .leading) {
      if isTicked {
        Ripple(color: example.color)
          .offset(x: -4)
      }
    }
    .scaleEffect(isTicked ? 1.03 : 1)
  }
}

/// Where a finger has pressed: a ring that spreads and fades, once.
private struct Ripple: View {
  let color: Color
  @State private var hasSpread = false

  var body: some View {
    Circle()
      .fill(color.opacity(0.3))
      .frame(width: 44, height: 44)
      .scaleEffect(hasSpread ? 2.2 : 0.4)
      .opacity(hasSpread ? 0 : 1)
      .allowsHitTesting(false)
      .onAppear {
        withAnimation(.easeOut(duration: 0.7)) { hasSpread = true }
      }
  }
}

extension AnyTransition {
  /// A part of an app being put in place: it drops in from a little above, out of a blur, and lands
  /// with a small bounce.
  fileprivate static var piece: AnyTransition {
    .modifier(active: Placing(isAway: true), identity: Placing(isAway: false))
  }
}

private struct Placing: ViewModifier {
  let isAway: Bool
  func body(content: Content) -> some View {
    content
      .opacity(isAway ? 0 : 1)
      .scaleEffect(isAway ? 1.25 : 1)
      .offset(y: isAway ? -14 : 0)
      .blur(radius: isAway ? 6 : 0)
  }
}

#Preview {
  IntroView { _ in }
}
