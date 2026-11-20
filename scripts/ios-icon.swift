// Draws the Appsmedjan app icon: a white anvil with sparks on the forge's orange.
// The shapes are drawn here by hand; Apple does not allow its SF Symbols in app icons.
//   swift scripts/ios-icon.swift ios/Sources/Assets.xcassets/AppIcon.appiconset/icon.png
import AppKit

let side: CGFloat = 1024
// An opaque canvas: Apple refuses icons with an alpha channel.
let canvas = CGContext(
  data: nil, width: Int(side), height: Int(side), bitsPerComponent: 8, bytesPerRow: 0,
  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: canvas, flipped: false)

let top = NSColor(red: 0.96, green: 0.48, blue: 0.14, alpha: 1)
let bottom = NSColor(red: 0.78, green: 0.25, blue: 0.02, alpha: 1)
NSGradient(colors: [top, bottom])!.draw(in: NSRect(x: 0, y: 0, width: side, height: side), angle: -60)

NSColor.white.set()

// The anvil: horn to the left, heel to the right, a waist and a wide foot.
let anvil = NSBezierPath()
let outline: [(CGFloat, CGFloat)] = [
  (150, 610), (330, 650), (810, 650), (810, 575), (650, 545), (610, 455), (610, 395),
  (735, 330), (735, 270), (290, 270), (290, 330), (415, 395), (415, 455), (360, 525), (250, 565),
]
anvil.move(to: NSPoint(x: outline[0].0, y: outline[0].1))
for point in outline.dropFirst() { anvil.line(to: NSPoint(x: point.0, y: point.1)) }
anvil.close()
anvil.lineJoinStyle = .round
anvil.lineWidth = 36
anvil.fill()
anvil.stroke()

// Sparks flying off the face: four-pointed stars.
func spark(x: CGFloat, y: CGFloat, size: CGFloat) {
  let star = NSBezierPath()
  let thin = size * 0.22
  star.move(to: NSPoint(x: x, y: y + size))
  star.line(to: NSPoint(x: x + thin, y: y + thin))
  star.line(to: NSPoint(x: x + size, y: y))
  star.line(to: NSPoint(x: x + thin, y: y - thin))
  star.line(to: NSPoint(x: x, y: y - size))
  star.line(to: NSPoint(x: x - thin, y: y - thin))
  star.line(to: NSPoint(x: x - size, y: y))
  star.line(to: NSPoint(x: x - thin, y: y + thin))
  star.close()
  star.fill()
}
spark(x: 560, y: 800, size: 74)
spark(x: 720, y: 760, size: 46)
spark(x: 420, y: 755, size: 40)

NSGraphicsContext.restoreGraphicsState()
let png = NSBitmapImageRep(cgImage: canvas.makeImage()!).representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
