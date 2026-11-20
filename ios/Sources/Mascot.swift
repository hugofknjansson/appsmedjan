// The mascot: the app tile from the icon, standing in its pose or dancing.
// Drawn on the icon's 32-unit grid, so it is the same figure as scripts/ios-icon.swift and the web logo.
import SwiftUI

struct Mascot: View {
  /// The tile and its arms and legs.
  var tile: Color = .brand
  var eyes: Color = .white
  var isDancing = false
  /// Cheering instead of going through the dance: jumping with both arms in the air, for good news.
  var isCheering = false
  /// Waving hello instead of dancing: standing where it is and waving the arm it has in the air.
  var isWaving = false

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var moves: Bool { (isDancing || isCheering || isWaving) && !reduceMotion }

  /// The one move it keeps to, or nil for the whole dance. Cheering wins over dancing, dancing over waving.
  private var only: Int? { isCheering ? 1 : isDancing ? nil : isWaving ? 4 : nil }

  var body: some View {
    TimelineView(.animation(paused: !moves)) { timeline in
      let pose = moves ? MascotPose(time: timeline.date.timeIntervalSinceReferenceDate, only: only) : .icon
      Canvas { context, size in
        pose.draw(in: &context, size: size, tile: tile, eyes: eyes)
      }
    }
    .aspectRatio(1, contentMode: .fit)
    // Decoration: what it stands next to says what is going on.
    .accessibilityHidden(true)
  }
}

/// The mascot in white on the brand orange, as on the home screen.
struct MascotBadge: View {
  var isDancing = false
  var isCheering = false

  var body: some View {
    Mascot(tile: .white, eyes: .brandDeep, isDancing: isDancing, isCheering: isCheering)
      .background(.brandGradient, in: .rect(cornerRadius: 9, style: .continuous))
  }
}

/// Where the mascot is in its dance.
nonisolated struct MascotPose {
  /// 0 is the pose of the icon, 1 its mirror image: the other arm in the air, the other leg kicking.
  var swing: Double
  /// How high off the ground it is, in hops: 1 is the small hop between two poses.
  var lift: Double
  /// 0 with the eyes open, 1 with them shut.
  var blink: Double
  /// 1 facing us, -1 facing away, and everything between while it spins on the spot.
  var turn: Double = 1
  /// How far it has slid to the side, in grid units.
  var slide: Double = 0
  /// How far the raised arm has swung around its shoulder, in radians: a wave.
  var wave: Double = 0
  /// 1 at its own height; below when it is squashed against the ground, above when stretched in the air.
  var stretch: Double = 1
  /// How far the eyes have moved to the side, in grid units: it looks where it is going.
  var gaze: Double = 0

  static let icon = MascotPose(swing: 0, lift: 0, blink: 0)

  static let beat = 1.15
  /// Four beats. Every phrase starts and ends in the icon's pose, so one move flows into the next.
  static let phrase = beat * 4
  private static let blinkEvery = 3.4

  init(swing: Double, lift: Double, blink: Double) {
    self.swing = swing
    self.lift = lift
    self.blink = blink
  }

  /// The dance goes through six phrases: the swing, a row of jumps, the swing again, a pirouette, a
  /// wave and a slide from side to side. `only` keeps it to one of them, over and over: 1 (the
  /// jumps) is cheering, 4 (the wave) is saying hello.
  init(time: Double, only: Int? = nil) {
    let local = time.truncatingRemainder(dividingBy: Self.phrase) / Self.phrase
    let angle = time / Self.beat * 2 * .pi
    // A sine that lingers at both ends, so each pose is held for a moment before the swap.
    let sway = (1 - cos(angle)) / 2
    let swung = sway * sway * (3 - 2 * sway)
    // 0 at both ends of the phrase, 1 for most of it: what a move adds fades in and out.
    let ease = min(1, local / 0.12, (1 - local) / 0.12)
    let hop = pow(abs(sin(angle)), 3)
    switch only ?? Int(time / Self.phrase) % 6 {
    case 1:
      // Jumps: both arms half-way up, straight up and down, squashed on landing and stretched in the air.
      let height = pow(abs(sin(angle)), 0.8)
      swing = 0.5 * ease
      lift = height * 2.2
      stretch = 1 + ease * (0.14 * height - 0.08)
    case 3:
      // A pirouette: the swing goes on while it turns around twice.
      swing = swung
      lift = hop
      turn = cos(local * 4 * .pi)
    case 4:
      // A wave: it stands in the icon's pose, bobbing a little, and waves the arm it has in the air.
      swing = 0
      lift = 0.3 * ease * abs(sin(angle))
      wave = ease * sin(angle * 2) * 0.38
      gaze = 0.35 * ease
    case 5:
      // A slide: the swing goes on while it glides out to one side, back, and out to the other.
      swing = swung
      lift = hop
      slide = sin(local * 2 * .pi) * 3
    default:
      swing = swung
      lift = hop
    }
    // The eyes follow the arm in the air.
    gaze += 0.3 * (1 - 2 * swing) * ease
    blink = time.truncatingRemainder(dividingBy: Self.blinkEvery) < 0.13 ? 1 : 0
  }

  // The four limbs of the icon's pose, from the tile outwards.
  private static let armUp = [CGPoint(x: 21.5, y: 12.5), CGPoint(x: 24.5, y: 9.8), CGPoint(x: 27.4, y: 7.2)]
  private static let armBent = [CGPoint(x: 11, y: 13.5), CGPoint(x: 5.8, y: 15.6), CGPoint(x: 6.6, y: 11.2)]
  private static let legStanding = [CGPoint(x: 13.4, y: 18), CGPoint(x: 12.6, y: 22.6), CGPoint(x: 13.4, y: 27.2), CGPoint(x: 10.6, y: 27.2)]
  private static let legKicking = [CGPoint(x: 18, y: 18.5), CGPoint(x: 20.8, y: 23.2), CGPoint(x: 25.8, y: 21.8), CGPoint(x: 25.8, y: 21.8)]

  private static func mirrored(_ limb: [CGPoint]) -> [CGPoint] {
    limb.map { CGPoint(x: 32 - $0.x, y: $0.y) }
  }

  /// Each limb on its way to what the limb on the other side does in the icon.
  private var limbs: [[CGPoint]] {
    let pairs = [
      (Self.armUp, Self.mirrored(Self.armBent)),
      (Self.armBent, Self.mirrored(Self.armUp)),
      (Self.legStanding, Self.mirrored(Self.legKicking)),
      (Self.legKicking, Self.mirrored(Self.legStanding)),
    ]
    var limbs = pairs.map { from, to in
      zip(from, to).map { a, b in CGPoint(x: a.x + (b.x - a.x) * swing, y: a.y + (b.y - a.y) * swing) }
    }
    // The wave turns the raised arm around its shoulder.
    if wave != 0, let shoulder = limbs[0].first {
      limbs[0] = limbs[0].map { point in
        let x = point.x - shoulder.x, y = point.y - shoulder.y
        return CGPoint(x: shoulder.x + x * cos(wave) - y * sin(wave), y: shoulder.y + x * sin(wave) + y * cos(wave))
      }
    }
    return limbs
  }

  func draw(in context: inout GraphicsContext, size: CGSize, tile: Color, eyes: Color) {
    let unit = min(size.width, size.height) / 32
    var figure = context
    figure.translateBy(x: (size.width - 32 * unit) / 2 + slide * unit, y: (size.height - 32 * unit) / 2 - lift * 1.3 * unit)
    figure.scaleBy(x: unit, y: unit)
    // Turning on the spot: the figure narrows to nothing and widens again as its mirror image.
    // Squashed, it is also a little wider; stretched, a little narrower. Both from where it stands.
    let facing = abs(turn) < 0.03 ? (turn < 0 ? -0.03 : 0.03) : turn
    figure.translateBy(x: 16, y: 27.2)
    figure.scaleBy(x: facing * (1 + (1 - stretch) * 0.6), y: stretch)
    figure.translateBy(x: -16, y: -27.2)

    var strokes = Path()
    for limb in limbs { strokes.addLines(limb) }
    figure.stroke(strokes, with: .color(tile), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))

    // The tile leans into the step: ten degrees one way in the icon, ten the other in its mirror image.
    figure.translateBy(x: 16, y: 12.5)
    figure.rotate(by: .degrees(10 * (1 - 2 * swing)))
    figure.fill(Path(roundedRect: CGRect(x: -6.5, y: -6.5, width: 13, height: 13), cornerRadius: 3.6), with: .color(tile))

    let open = 3 * (1 - 0.85 * blink)
    for x in [-3.05, 1.55] {
      let eye = CGRect(x: x + gaze, y: -0.9 - open / 2, width: 1.5, height: open)
      figure.fill(Path(roundedRect: eye, cornerRadius: min(0.75, open / 2)), with: .color(eyes))
    }
  }
}

#Preview {
  VStack(spacing: 24) {
    Mascot(isDancing: true).frame(width: 160)
    MascotBadge().frame(width: 64)
  }
}
