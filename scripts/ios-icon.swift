// Draws the App Dance app icon: an app tile mid-step, one arm in the air, on the brand orange.
// The shapes are drawn here by hand; Apple does not allow its SF Symbols in app icons.
//   swift scripts/ios-icon.swift ios/Sources/Assets.xcassets/AppIcon.appiconset/icon.png
//
// The figure is laid out on the same 32-unit grid as the logo in web/src/Logo.tsx (y pointing down),
// so the two stay the same drawing: change one and copy the numbers to the other.
import AppKit

let side: CGFloat = 1024
let unit = side / 32
// An opaque canvas: Apple refuses icons with an alpha channel.
let canvas = CGContext(
  data: nil, width: Int(side), height: Int(side), bitsPerComponent: 8, bytesPerRow: 0,
  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: canvas, flipped: false)

let top = NSColor(red: 0.96, green: 0.48, blue: 0.14, alpha: 1)
let bottom = NSColor(red: 0.78, green: 0.25, blue: 0.02, alpha: 1)
NSGradient(colors: [top, bottom])!.draw(in: NSRect(x: 0, y: 0, width: side, height: side), angle: -60)

/// A point on the 32-unit grid, turned the right way up for AppKit.
func at(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x * unit, y: (32 - y) * unit) }

NSColor.white.set()

// Arms and legs: round strokes through the given points.
func limb(_ points: [(CGFloat, CGFloat)]) {
  let path = NSBezierPath()
  path.move(to: at(points[0].0, points[0].1))
  for point in points.dropFirst() { path.line(to: at(point.0, point.1)) }
  path.lineWidth = 2.2 * unit
  path.lineCapStyle = .round
  path.lineJoinStyle = .round
  path.stroke()
}
limb([(21.5, 12.5), (27.4, 7.2)]) // the arm in the air
limb([(11, 13.5), (5.8, 15.6), (6.6, 11.2)]) // the other arm, bent at the elbow
limb([(13.4, 18), (12.6, 22.6), (13.4, 27.2), (10.6, 27.2)]) // the standing leg
limb([(18, 18.5), (20.8, 23.2), (25.8, 21.8)]) // the kicking leg

// The body: an app tile, leaning into the step.
let tile = NSBezierPath(roundedRect: NSRect(x: -6.5 * unit, y: -6.5 * unit, width: 13 * unit, height: 13 * unit), xRadius: 3.6 * unit, yRadius: 3.6 * unit)
var lean = AffineTransform(translationByX: at(16, 12.5).x, byY: at(16, 12.5).y)
lean.rotate(byDegrees: -10)
tile.transform(using: lean)
tile.fill()

// Two eyes, leaning with the tile.
bottom.set()
for x in [-2.3, 2.3] as [CGFloat] {
  let eye = NSBezierPath(roundedRect: NSRect(x: (x - 0.75) * unit, y: -0.6 * unit, width: 1.5 * unit, height: 3 * unit), xRadius: 0.75 * unit, yRadius: 0.75 * unit)
  eye.transform(using: lean)
  eye.fill()
}

NSGraphicsContext.restoreGraphicsState()
let png = NSBitmapImageRep(cgImage: canvas.makeImage()!).representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
