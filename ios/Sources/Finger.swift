// The finger on the streamed screen: seen the moment it lands, and sent a little ahead of itself.
//
// What the finger does reaches the simulator a tenth of a second or so later than it would reach an
// app on the phone itself. iOS can say where a moving finger will be a moment from now (it is how a
// line drawn with a pencil keeps up with its tip), and sending that place instead of the one the
// finger is at takes a frame's worth off the wait, for whatever follows the finger in the simulator.
import SwiftUI
import UIKit.UIGestureRecognizerSubclass

/// One finger's way across the streamed screen, as what is sent to the simulator. Places are in
/// points of the screen as it is shown here; what is sent is in shares of its width and height.
nonisolated struct FingerTrack {
  /// The shortest time between two reports of where the finger is. The simulator draws sixty times
  /// a second, and a phone reports its finger twice as often as that. A gap of exactly a sixtieth
  /// would let through only every third report: the second one comes a hair too early.
  static let moveGap: TimeInterval = 0.012
  /// A finger moving slower than this when it lifts has stopped, in points a second.
  static let stillSpeed = 80.0
  /// A finger that has not moved for this long before it lifts has stopped too.
  static let stillAfter: TimeInterval = 0.05

  private let size: CGSize
  /// Where the simulator's finger was last put, and when.
  private var sent: (at: TimeInterval, place: CGPoint)
  /// Where the finger here was last seen, and when.
  private var seen: (at: TimeInterval, place: CGPoint)
  /// How fast it was going between the last two times it was seen, in points a second.
  private var speed = 0.0
  /// True once a place ahead of the finger has been sent.
  private var wentAhead = false

  /// A finger that has just landed.
  init(landingAt place: CGPoint, time: TimeInterval, on size: CGSize) {
    self.size = size
    sent = (time, place)
    seen = (time, place)
  }

  /// The finger going down where it landed.
  var landing: InputEvent { touch(.down, at: sent.place) }

  /// The finger has moved to `place`, and is, as far as iOS can tell, heading for `heading`. Nil
  /// when this move is not sent: no more often than the simulator draws.
  mutating func move(to place: CGPoint, heading: CGPoint?, time: TimeInterval) -> InputEvent? {
    let elapsed = time - seen.at
    if elapsed > 0 { speed = hypot(place.x - seen.place.x, place.y - seen.place.y) / elapsed }
    seen = (time, place)
    guard time - sent.at >= Self.moveGap else { return nil }
    if heading != nil { wentAhead = true }
    sent = (time, heading ?? place)
    return touch(.move, at: sent.place)
  }

  /// The finger lifts at `place`. One that had stopped lifts exactly there. One that was still
  /// moving lifts where the simulator's finger already is, a little ahead: putting it back where
  /// the finger really was would be a step backwards at the very end, which is what a list reads
  /// its speed from when it is let go of.
  func lift(at place: CGPoint, time: TimeInterval) -> InputEvent {
    let stopped = time - seen.at > Self.stillAfter || speed < Self.stillSpeed
    return touch(.up, at: wentAhead && !stopped ? sent.place : place)
  }

  /// The finger taken away without lifting, as when the screen goes away under it: the simulator's
  /// finger lifts where it is.
  var letGo: InputEvent { touch(.up, at: sent.place) }

  private func touch(_ phase: InputEvent.Phase, at place: CGPoint) -> InputEvent {
    .touch(phase, x: Self.share(place.x, of: size.width), y: Self.share(place.y, of: size.height))
  }

  /// A place as a share of the screen's width or height, between 0 and 1.
  private static func share(_ place: CGFloat, of length: CGFloat) -> Double {
    length > 0 ? min(max(place / length, 0), 1) : 0
  }
}

/// Lies over the streamed screen and sends on what a finger does there.
struct FingerSurface: UIViewRepresentable {
  /// False while touches cannot be sent on; a finger that is down then is let go of.
  let isOn: Bool
  /// True when a moving finger is sent where it is heading instead of where it is.
  let looksAhead: Bool
  let send: (InputEvent) -> Void

  func makeCoordinator() -> FingerRecognizer { FingerRecognizer() }

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.backgroundColor = .clear
    view.addGestureRecognizer(context.coordinator)
    return view
  }

  func updateUIView(_ view: UIView, context: Context) {
    let recognizer = context.coordinator
    recognizer.send = send
    recognizer.looksAhead = looksAhead
    // Turning it off in the middle of a gesture ends the gesture, which lifts the finger.
    if recognizer.isEnabled != isOn { recognizer.isEnabled = isOn }
  }

  static func dismantleUIView(_ view: UIView, coordinator: FingerRecognizer) {
    coordinator.letGo()
  }
}

/// Takes a finger from the moment it lands, so that nothing waits to see what kind of gesture it
/// will turn out to be, and follows that one finger until it lifts.
final class FingerRecognizer: UIGestureRecognizer {
  var looksAhead = true
  var send: (InputEvent) -> Void = { _ in }

  private var finger: UITouch?
  private var track: FingerTrack?

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    for touch in touches {
      guard finger == nil, let view, view.bounds.width > 0, view.bounds.height > 0 else {
        // One finger at a time is what the simulator is sent.
        ignore(touch, for: event)
        continue
      }
      let track = FingerTrack(landingAt: touch.location(in: view), time: touch.timestamp, on: view.bounds.size)
      finger = touch
      self.track = track
      send(track.landing)
      state = .began
    }
    if finger == nil { state = .failed }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let finger, touches.contains(finger), let view, var track else { return }
    let heading = looksAhead ? event.predictedTouches(for: finger)?.last?.location(in: view) : nil
    let move = track.move(to: finger.location(in: view), heading: heading, time: finger.timestamp)
    self.track = track
    if let move { send(move) }
    state = .changed
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let finger, touches.contains(finger), let view, let track else { return }
    self.track = nil
    send(track.lift(at: finger.location(in: view), time: finger.timestamp))
    state = .ended
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let finger, touches.contains(finger) else { return }
    letGo()
    state = .cancelled
  }

  override func reset() {
    super.reset()
    // Also where a gesture ends that was stopped from outside, with no word of the finger lifting.
    letGo()
    finger = nil
  }

  /// Lifts the simulator's finger where it is, if it is down.
  func letGo() {
    guard let track else { return }
    self.track = nil
    send(track.letGo)
  }
}
