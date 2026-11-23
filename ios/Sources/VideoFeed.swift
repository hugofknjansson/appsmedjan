// The simulator's screen as video: H.264, one picture per frame of the stream, handed to the
// system's own layer for showing video the moment it arrives.
import AVFoundation
import CoreMedia
import Observation
import SwiftUI

/// What a frame of the stream is. The same reckoning as `frameKind` on the server's side.
nonisolated enum StreamFrame {
  /// still: a picture that stands on its own (a JPEG). key: a picture of the video that stands on
  /// its own, with the settings needed to read the ones after it. delta: only what changed since
  /// the picture before it, so of no use to anyone who missed that one.
  enum Kind { case still, key, delta }

  private static let start: [UInt8] = [0, 0, 0, 1]

  static func kind(of frame: Data) -> Kind {
    guard frame.count > 4, frame.prefix(4).elementsEqual(start) else { return .still }
    for unit in units(in: frame.prefix(512)) {
      switch unit.first.map({ $0 & 0x1f }) {
      case 5, 7: return .key
      case 1: return .delta
      default: continue
      }
    }
    return .delta
  }

  /// The units a picture is made of, without the start codes between them.
  static func units(in frame: Data) -> [Data] {
    var units: [Data] = []
    var from: Data.Index?
    var index = frame.startIndex
    while index + 3 < frame.endIndex {
      if frame[index] == 0, frame[index + 1] == 0, frame[index + 2] == 0, frame[index + 3] == 1 {
        if let from, from < index { units.append(frame[from..<index]) }
        from = index + 4
        index += 4
      } else {
        index += 1
      }
    }
    if let from, from < frame.endIndex { units.append(frame[from...]) }
    return units
  }
}

@Observable
final class VideoFeed {
  /// Where the video is drawn.
  @ObservationIgnored let layer = AVSampleBufferDisplayLayer()
  /// The size of the pictures, known once the first key picture has come.
  private(set) var size: CGSize?

  @ObservationIgnored private var format: CMVideoFormatDescription?
  /// True until a key picture has been shown: nothing before it can be.
  @ObservationIgnored private var waitsForKey = true

  init() {
    layer.videoGravity = .resize
  }

  /// Shows one picture of the video. Throws when the video cannot be read, which is a reason to
  /// ask for still pictures instead.
  func show(_ frame: Data, kind: StreamFrame.Kind) throws {
    let renderer = layer.sampleBufferRenderer
    // After a failure, or a spell in the background, the system wants to start again from a key picture.
    if renderer.status == .failed || renderer.requiresFlushToResumeDecoding {
      renderer.flush()
      waitsForKey = true
    }
    let units = StreamFrame.units(in: frame)
    if kind == .key {
      let settings = units.filter { [7, 8].contains(($0.first ?? 0) & 0x1f) }.map { Data($0) }
      guard settings.count >= 2 else { return }
      let format = try CMVideoFormatDescription(h264ParameterSets: settings, nalUnitHeaderLength: 4)
      self.format = format
      let dimensions = format.dimensions
      let size = CGSize(width: Int(dimensions.width), height: Int(dimensions.height))
      if size != self.size { self.size = size }
      waitsForKey = false
    }
    guard !waitsForKey, let format else { return }

    // The picture's own data, each unit with its length in front of it, which is how the system reads it.
    var bytes = Data()
    for unit in units where [1, 5].contains((unit.first ?? 0) & 0x1f) {
      withUnsafeBytes(of: UInt32(unit.count).bigEndian) { bytes.append(contentsOf: $0) }
      bytes.append(unit)
    }
    guard !bytes.isEmpty else { return }
    let block = try CMBlockBuffer(length: bytes.count)
    try bytes.withUnsafeBytes { try block.replaceDataBytes(with: $0) }
    let sample = try CMSampleBuffer(
      dataBuffer: block,
      formatDescription: format,
      numSamples: 1,
      sampleTimings: [CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .invalid, decodeTimeStamp: .invalid)],
      sampleSizes: [bytes.count]
    )
    // Shown as soon as it is decoded: this is a live picture, not a film with a clock of its own.
    sample.sampleAttachments[0][.displayImmediately] = true
    renderer.enqueue(sample)
  }

  /// Starts again from the next whole picture, for a new connection. The last picture stays on
  /// screen until then.
  func restart() {
    layer.sampleBufferRenderer.flush()
    waitsForKey = true
  }

  /// Forgets the video, for when the screen goes away or comes as still pictures again.
  func reset() {
    layer.sampleBufferRenderer.flush(removingDisplayedImage: true, completionHandler: nil)
    format = nil
    size = nil
    waitsForKey = true
  }
}

/// The feed's layer, filling whatever room it is given.
struct VideoScreen: UIViewRepresentable {
  let feed: VideoFeed

  func makeUIView(context: Context) -> Holder { Holder() }

  func updateUIView(_ view: Holder, context: Context) {
    view.hold(feed.layer)
  }

  final class Holder: UIView {
    private var held: CALayer?

    func hold(_ layer: CALayer) {
      guard held !== layer else { return }
      held?.removeFromSuperlayer()
      held = layer
      self.layer.addSublayer(layer)
      setNeedsLayout()
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      // Without the implicit animation a layer gets when its frame changes.
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      held?.frame = bounds
      CATransaction.commit()
    }
  }
}
