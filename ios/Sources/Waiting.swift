// What makes a wait worth watching: the dancing mascot wherever something takes time, lines that
// take turns under it, and confetti when something has gone well.
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
  /// The show that fills the screen while the app is built: how an app is made, a line at a time.
  static func show(_ phase: RunProgress.Phase) -> [String] {
    switch phase {
    case .thinking: [
      String(localized: "Läser det du skrev, ord för ord"),
      String(localized: "Bestämmer vilka skärmar appen behöver"),
      String(localized: "Skissar hur allt ska hänga ihop"),
    ]
    case .making: [
      String(localized: "Varje skärm ritas upp, en i taget"),
      String(localized: "Knapparna får lära sig vad de ska göra"),
      String(localized: "Färger och former väljs så att de passar ihop"),
      String(localized: "Appen får ett minne, så att inget försvinner"),
      String(localized: "Dansar fram din app"),
      String(localized: "Texterna skrivs så att de är lätta att läsa"),
      String(localized: "Tar en piruett medan det blir klart"),
    ]
    case .drawing: [
      String(localized: "Ikonen är den lilla bilden på hemskärmen"),
      String(localized: "Den ritas för att synas bland dina andra appar"),
    ]
    case .trying: [
      String(localized: "Appen startas på en provtelefon"),
      String(localized: "Alla knappar trycks på, en efter en"),
      String(localized: "Fungerar allt får du den snart"),
    ]
    case .fixing: [
      String(localized: "Något satt lite snett, det rättas nu"),
      String(localized: "Sedan provkörs appen en gång till"),
      String(localized: "Så går det till när appar byggs"),
    ]
    case .looking: [
      String(localized: "Skärmen granskas, precis som du kommer att se den"),
      String(localized: "Blev det som du bad om?"),
    ]
    }
  }

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
  /// The person's apps are being fetched.
  static let apps = [
    String(localized: "Hämtar dina appar"),
    String(localized: "Dammar av hyllan"),
  ]
  /// The app is on its way up to Apple.
  static let upload = [
    String(localized: "Packar ihop appen"),
    String(localized: "Knyter ett snöre om paketet"),
    String(localized: "Bär paketet till Apple"),
    String(localized: "Ringer på hos Apple"),
  ]
  /// Apple has the app and is getting it ready.
  static let processing = [
    String(localized: "Apple packar upp"),
    String(localized: "Apple räknar skruvarna"),
    String(localized: "Apple provstartar appen"),
  ]
  /// Texts for the App Store are being written.
  static let draft = [
    String(localized: "Vässar pennan"),
    String(localized: "Letar efter rätt ord"),
    String(localized: "Stryker det tråkiga"),
    String(localized: "Läser högt för sig själv"),
  ]
  /// The App Store page is on its way to Apple.
  static let store = [
    String(localized: "Bär texterna till Apple"),
    String(localized: "Hänger upp bilderna"),
    String(localized: "Rättar till skylten"),
  ]
  /// The app is being handed in for review.
  static let review = [
    String(localized: "Lägger appen i Apples brevlåda"),
    String(localized: "Kollar att allt är med"),
  ]
  /// The person's plan is being fetched.
  static let plan = [
    String(localized: "Rullar ut mattan"),
    String(localized: "Putsar din plan"),
  ]
  /// Apple is asked whether the person's key is good.
  static let checking = [
    String(localized: "Knackar på hos Apple"),
    String(localized: "Visar upp nyckeln"),
    String(localized: "Väntar på tummen upp"),
  ]
  /// An invitation is on its way.
  static let invite = [
    String(localized: "Skriver inbjudan"),
    String(localized: "Slickar på frimärket"),
  ]
}

/// What is shown while something takes its time: the mascot dancing, with a line under it that
/// changes every few seconds. Nobody is left looking at a spinner or an empty page.
struct Waiting: View {
  var lines: [String] = []
  var size: CGFloat = 120

  var body: some View {
    VStack(spacing: 12) {
      Mascot(isDancing: true)
        .frame(width: size)
      if !lines.isEmpty {
        WaitingCaption(lines: lines)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 24)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(lines.first ?? String(localized: "Ett ögonblick"))
  }
}

/// A wait in the middle of other things: what is going on, a line that changes, and, when it is
/// known how far it has come, a bar.
struct WaitCard: View {
  let title: String
  let lines: [String]
  var fraction: Double?

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      MascotBadge(isDancing: true)
        .frame(width: 44)
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.subheadline.weight(.semibold))
          .contentTransition(.opacity)
        WaitingCaption(lines: lines)
          .font(.footnote)
          .foregroundStyle(.secondary)
        if let fraction {
          ProgressView(value: fraction)
            .tint(.brand)
            .animation(.smooth(duration: 0.6), value: fraction)
            .padding(.top, 4)
            .accessibilityLabel("Hur långt det har kommit")
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .animation(Motion.swap, value: title)
    .accessibilityElement(children: .combine)
  }
}

/// The mascot dancing where a spinner would have been: in a button that is busy, or beside a step
/// that is under way.
struct BusyMark: View {
  /// White on the brand orange, as in a filled button.
  var isOnBrand = false
  var size: CGFloat = 28

  var body: some View {
    Mascot(tile: isOnBrand ? .white : .brand, eyes: isOnBrand ? .brandDeep : .white, isDancing: true)
      .frame(width: size, height: size)
      .accessibilityElement()
      .accessibilityLabel("Ett ögonblick")
  }
}

/// Apple's own words about what it turned down, kept behind a press: they are in English and full
/// of Apple's names for things, and most people only need to know that it did not go through.
struct Detail: View {
  let text: String

  /// Open from the start for the people who are shown more than the first level.
  @State private var isOpen = Depth.shared.showsMore

  var body: some View {
    if !text.isEmpty {
      DisclosureGroup("Visa vad Apple svarade", isExpanded: $isOpen) {
        Text(text)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, 4)
      }
      .font(.footnote.weight(.semibold))
      .tint(.secondary)
      // Someone who goes looking for Apple's own words may well want more of the kind.
      .onChange(of: isOpen) { _, open in
        guard open, !Depth.shared.showsMore else { return }
        Task { try? await API(baseURL: API.configuredBaseURL).levelAct("details") }
      }
    }
  }
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
  static func noise(_ piece: Int, _ salt: Int) -> Double {
    let mixed = sin(Double(piece * 97 + salt * 131) * 12.9898) * 43758.5453
    return mixed - mixed.rounded(.down)
  }
}
