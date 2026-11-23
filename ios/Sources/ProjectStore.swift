// Live state of one open app: the conversation, the agent's work in progress, and the simulator
// preview. Everything arrives over one WebSocket; this type folds the events into state.
import Foundation
import Observation
import UIKit
import os

@Observable
final class ProjectStore {
  let id: String
  private let api: API
  private let log = Logger(subsystem: "app.appsmedjan.ios", category: "project")

  private(set) var name: String
  private(set) var messages: [ChatMessage] = []
  /// True while the agent is working.
  private(set) var isRunning = false
  /// The parts of the answer being written right now.
  private(set) var liveParts: [Part] = []

  /// True when the builder's latest answer says that something went wrong.
  var lastRunFailed: Bool {
    messages.last?.parts.contains { part in
      if case .error = part { true } else { false }
    } ?? false
  }
  private(set) var preview = PreviewState.idle
  private(set) var publish = PublishState.none
  /// The simulator's screen as a still picture, when it arrives as those.
  private(set) var frame: UIImage?
  /// The simulator's screen as video, when it arrives as that.
  let video = VideoFeed()
  /// True while the screen arrives as video and `video` is what to show.
  private(set) var showsVideo = false
  /// True when there is a picture of the screen to show, as video or as a still.
  var hasPicture: Bool { showsVideo ? video.size != nil : frame != nil }
  /// False once video has turned out not to work on this device; still pictures are asked for from then on.
  @ObservationIgnored private var takesVideo = true
  private(set) var isConnected = false
  /// Set when the server keeps refusing the connection: the app is gone, or is someone else's.
  private(set) var isMissing = false
  /// Becomes true once the first full state has arrived.
  private(set) var isLoaded = false

  private var socket: URLSessionWebSocketTask?
  /// True once the simulator has been woken on this connection; each new connection wakes it again.
  private var askedForPreview = false
  /// True while the app is in the background. There is then no connection: nothing is streamed for
  /// nobody to see, and the simulator is let go of after a while like for anyone who has left. A
  /// connection kept through the background is the one that looks open on the way back and is not.
  private var isPaused = false

  init(project: ProjectSummary, api: API) {
    id = project.id
    name = project.name
    self.api = api
  }

  /// Shows a frame of the stream. False when it is video that cannot be read here.
  private func show(_ data: Data) -> Bool {
    let kind = StreamFrame.kind(of: data)
    guard kind != .still else {
      if let picture = UIImage(data: data) {
        frame = picture
        if showsVideo {
          showsVideo = false
          video.reset()
        }
      }
      return true
    }
    do {
      try video.show(data, kind: kind)
    } catch {
      log.debug("video could not be shown: \(error.localizedDescription, privacy: .public)")
      return false
    }
    // Only once there is a picture to see: until the first key picture there is none.
    if !showsVideo, video.size != nil {
      showsVideo = true
      frame = nil
    }
    return true
  }

  /// Keeps the connection up until the surrounding task is cancelled (the view went away).
  func run() async {
    var delay = Duration.milliseconds(500)
    var failures = 0
    while !Task.isCancelled && !isMissing {
      while isPaused && !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(200))
      }
      if Task.isCancelled { break }
      let task = URLSession.shared.webSocketTask(with: api.socketRequest(projectID: id, takesVideo: takesVideo))
      socket = task
      askedForPreview = false
      // What is on screen stays until the new connection brings something newer, but the video
      // starts again from a whole picture, which is the first thing a new connection is sent.
      video.restart()
      task.resume()
      do {
        while true {
          switch try await task.receive() {
          case .data(let data):
            if !show(data) {
              // Video this device cannot read: connect again, now asking for still pictures.
              takesVideo = false
              task.cancel(with: .goingAway, reason: nil)
            }
          case .string(let text):
            receive(text)
            delay = .milliseconds(500)
            failures = 0
          @unknown default:
            break
          }
        }
      } catch {
        log.debug("socket closed: \(error.localizedDescription, privacy: .public)")
      }
      task.cancel(with: .goingAway, reason: nil)
      socket = nil
      isConnected = false
      // Closed for the background, not refused: straight back when the app is.
      if isPaused {
        delay = .milliseconds(500)
        continue
      }
      // A project that never lets us in does not exist, or is not ours.
      failures += 1
      if !isLoaded && failures >= 3 { isMissing = true }
      try? await Task.sleep(for: delay)
      delay = min(delay * 2, .seconds(8))
    }
  }

  private func receive(_ text: String) {
    guard let event = try? JSONDecoder().decode(ServerEvent.self, from: Data(text.utf8)) else {
      log.error("could not read a server event")
      return
    }
    apply(event)
    if case .state = event {
      isConnected = true
      isLoaded = true
      // No simulator is running for the app any more (it was let go of while nobody watched): the
      // picture still on screen is an old one, and is not left standing as if it were the app.
      if preview.status == .idle || preview.status == .unavailable {
        frame = nil
        showsVideo = false
        video.reset()
      }
      // Wake the simulator when the app is opened or come back to; after that the person decides.
      if !askedForPreview && !isRunning && preview.status == .idle { startPreview() }
      askedForPreview = true
    }
  }

  /// One event from the server, folded into the state. Synchronous, so the state is never half-updated.
  func apply(_ event: ServerEvent) {
    switch event {
    case .state(let name, let messages, let running, let parts, let preview, let publish):
      self.name = name
      self.messages = messages
      isRunning = running
      liveParts = parts
      self.preview = preview
      self.publish = publish
    case .runStart:
      isRunning = true
      liveParts = []
    case .runEnd:
      isRunning = false
      liveParts = []
    case .textDelta(let delta):
      if case .text(let soFar) = liveParts.last {
        liveParts[liveParts.count - 1] = .text(soFar + delta)
      } else {
        liveParts.append(.text(delta))
      }
    case .part(let part):
      liveParts.append(part)
    case .step(let step):
      // A step is first announced as running and later replaced by its outcome.
      if let index = liveParts.firstIndex(where: { if case .step(let existing) = $0 { existing.id == step.id } else { false } }) {
        liveParts[index] = .step(step)
      } else {
        liveParts.append(.step(step))
      }
    case .message(let message):
      if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
    case .preview(let preview):
      self.preview = preview
    case .publish(let publish):
      self.publish = publish
    case .frameClear:
      frame = nil
      showsVideo = false
      video.reset()
    case .renamed(let name):
      self.name = name
    case .filesChanged, .unknown:
      break
    }
  }

  // MARK: - The app in the background

  /// The app went to the background: the connection is closed until it comes back.
  func pause() {
    guard !isPaused else { return }
    isPaused = true
    socket?.cancel(with: .goingAway, reason: nil)
  }

  /// The app is in front again: a fresh connection, which brings the screen as it is now.
  func resume() {
    isPaused = false
  }

  // MARK: - Things the person does

  func send(_ text: String) async throws(APIError) {
    try await api.sendMessage(text, to: id)
  }

  func stop() async {
    try? await api.stopRun(id)
  }

  func sendToTestFlight() async throws(APIError) {
    try await api.sendToTestFlight(id)
  }

  func startPreview() {
    sendSocket(#"{"type":"preview.start"}"#)
  }

  func input(_ event: InputEvent) {
    struct Envelope: Encodable {
      let type = "input"
      let event: InputEvent
    }
    guard let data = try? JSONEncoder().encode(Envelope(event: event)) else { return }
    sendSocket(String(decoding: data, as: UTF8.self))
  }

  private func sendSocket(_ text: String) {
    guard let socket else { return }
    Task {
      do {
        try await socket.send(.string(text))
      } catch {
        log.debug("could not send: \(error.localizedDescription, privacy: .public)")
      }
    }
  }
}
