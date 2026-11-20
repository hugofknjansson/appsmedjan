// The mascot: the app tile from the icon, standing in its pose or dancing.
// Drawn on the icon's 32-unit grid, so it is the same figure as scripts/ios-icon.swift and the web logo.
import SwiftUI

struct Mascot: View {
  /// The tile and its arms and legs.
  var tile: Color = .brand
  var eyes: Color = .white
  var isDancing = false

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var moves: Bool { isDancing && !reduceMotion }

  var body: some View {
    TimelineView(.animation(paused: !moves)) { timeline in
      let pose = moves ? MascotPose(time: timeline.date.timeIntervalSinceReferenceDate) : .icon
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

  var body: some View {
    Mascot(tile: .white, eyes: .brandDeep, isDancing: isDancing)
      .background(.brandGradient, in: .rect(cornerRadius: 9, style: .continuous))
  }
}

/// Where the mascot is in its dance.
nonisolated struct MascotPose {
  /// 0 is the pose of the icon, 1 its mirror image: the other arm in the air, the other leg kicking.
  var swing: Double
  /// 0 on the ground, 1 at the top of the hop between the two poses.
  var lift: Double
  /// 0 with the eyes open, 1 with them shut.
  var blink: Double

  static let icon = MascotPose(swing: 0, lift: 0, blink: 0)

  private static let beat = 1.15
  private static let blinkEvery = 3.4

  init(swing: Double, lift: Double, blink: Double) {
    self.swing = swing
    self.lift = lift
    self.blink = blink
  }

  init(time: Double) {
    let turn = time / Self.beat * 2 * .pi
    // A sine that lingers at both ends, so each pose is held for a moment before the swap.
    let wave = (1 - cos(turn)) / 2
    swing = wave * wave * (3 - 2 * wave)
    lift = pow(abs(sin(turn)), 3)
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
    return pairs.map { from, to in
      zip(from, to).map { a, b in CGPoint(x: a.x + (b.x - a.x) * swing, y: a.y + (b.y - a.y) * swing) }
    }
  }

  func draw(in context: inout GraphicsContext, size: CGSize, tile: Color, eyes: Color) {
    let unit = min(size.width, size.height) / 32
    var figure = context
    figure.translateBy(x: (size.width - 32 * unit) / 2, y: (size.height - 32 * unit) / 2 - lift * 1.3 * unit)
    figure.scaleBy(x: unit, y: unit)

    var strokes = Path()
    for limb in limbs { strokes.addLines(limb) }
    figure.stroke(strokes, with: .color(tile), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))

    // The tile leans into the step: ten degrees one way in the icon, ten the other in its mirror image.
    figure.translateBy(x: 16, y: 12.5)
    figure.rotate(by: .degrees(10 * (1 - 2 * swing)))
    figure.fill(Path(roundedRect: CGRect(x: -6.5, y: -6.5, width: 13, height: 13), cornerRadius: 3.6), with: .color(tile))

    let open = 3 * (1 - 0.85 * blink)
    for x in [-3.05, 1.55] {
      let eye = CGRect(x: x, y: -0.9 - open / 2, width: 1.5, height: open)
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
