// The data the server sends and accepts. Mirrors shared/protocol.ts.
// Plain values with nothing to do with the screen, so they are not tied to the main actor.
import Foundation

nonisolated struct User: Codable, Equatable, Identifiable {
  let id: String
  let email: String
}

nonisolated struct ProjectSummary: Codable, Hashable, Identifiable {
  let id: String
  var name: String
  /// Milliseconds since 1970, as JavaScript counts time.
  let updatedAt: Double

  var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

/// A string-backed enum that survives values added on the server after this app was built.
nonisolated protocol LenientEnum: RawRepresentable, Decodable, Equatable where RawValue == String {
  static var fallback: Self { get }
}

nonisolated extension LenientEnum {
  init(from decoder: any Decoder) throws {
    let raw = try decoder.singleValueContainer().decode(String.self)
    self = Self(rawValue: raw) ?? Self.fallback
  }
}

// MARK: - Chat

/// One visible action the agent took, shown as a small progress row.
nonisolated struct Step: Decodable, Equatable, Identifiable {
  nonisolated enum Kind: String, LenientEnum {
    case write, edit, delete, read, build, look, rename, other
    static let fallback = Kind.other
  }

  nonisolated enum Status: String, LenientEnum {
    case running, done, error
    static let fallback = Status.done
  }

  let id: String
  let kind: Kind
  /// A file path, an app name, or empty. Phrased for people by `StepText`.
  let detail: String
  let status: Status
}

nonisolated enum Part: Decodable, Equatable {
  case text(String)
  case step(Step)
  /// An error code such as "rate_limited".
  case error(String)
  case unknown

  nonisolated private enum CodingKeys: String, CodingKey { case t, text, step, code }

  init(from decoder: any Decoder) throws {
    let box = try decoder.container(keyedBy: CodingKeys.self)
    switch try box.decode(String.self, forKey: .t) {
    case "text": self = .text(try box.decode(String.self, forKey: .text))
    case "step": self = .step(try box.decode(Step.self, forKey: .step))
    case "error": self = .error(try box.decode(String.self, forKey: .code))
    default: self = .unknown
    }
  }
}

nonisolated struct ChatMessage: Decodable, Equatable, Identifiable {
  nonisolated enum Role: String, LenientEnum {
    case user, assistant
    static let fallback = Role.assistant
  }

  let id: Int
  let role: Role
  let text: String
  let parts: [Part]
}

// MARK: - Preview

nonisolated struct PreviewState: Decodable, Equatable {
  nonisolated enum Status: String, LenientEnum {
    case idle, unavailable, building, running, failed
    static let fallback = Status.idle
  }

  var status: Status
  var stage: String?
  /// MIME type of the frames being streamed.
  var mime: String
  /// Whether taps and typing can be forwarded to the simulator.
  var canInput: Bool

  static let idle = PreviewState(status: .idle, stage: nil, mime: "image/jpeg", canInput: false)
}

/// Something done to the app in the simulator. Positions are 0...1 of the screen.
nonisolated enum InputEvent: Encodable {
  case tap(x: Double, y: Double)
  case swipe(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Int)
  case text(String)
  case key(Key)
  case home

  nonisolated enum Key: String, Encodable { case backspace, enter }

  nonisolated private enum CodingKeys: String, CodingKey { case kind, x, y, x1, y1, x2, y2, durationMs, text, key, button }

  func encode(to encoder: any Encoder) throws {
    var box = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .tap(let x, let y):
      try box.encode("tap", forKey: .kind)
      try box.encode(x, forKey: .x)
      try box.encode(y, forKey: .y)
    case .swipe(let x1, let y1, let x2, let y2, let durationMs):
      try box.encode("swipe", forKey: .kind)
      try box.encode(x1, forKey: .x1)
      try box.encode(y1, forKey: .y1)
      try box.encode(x2, forKey: .x2)
      try box.encode(y2, forKey: .y2)
      try box.encode(durationMs, forKey: .durationMs)
    case .text(let text):
      try box.encode("text", forKey: .kind)
      try box.encode(text, forKey: .text)
    case .key(let key):
      try box.encode("key", forKey: .kind)
      try box.encode(key, forKey: .key)
    case .home:
      try box.encode("button", forKey: .kind)
      try box.encode("home", forKey: .button)
    }
  }
}

// MARK: - TestFlight

nonisolated struct PublishState: Decodable, Equatable {
  nonisolated enum Account: String, LenientEnum {
    case own, `operator`, none
    static let fallback = Account.none
  }

  nonisolated enum Status: String, LenientEnum {
    case idle, working, uploaded, failed
    static let fallback = Status.idle
  }

  var available: Bool
  var account: Account
  var canConnect: Bool
  var status: Status
  var stage: String?
  var error: String?
  var bundleId: String?
  var build: String?
  var tester: String?
  /// When the status last changed, in milliseconds since 1970.
  var at: Double?

  static let none = PublishState(available: false, account: .none, canConnect: false, status: .idle)
}

// MARK: - Events from the server

/// A JSON message on the project's WebSocket. Simulator frames arrive separately, as binary.
nonisolated enum ServerEvent: Decodable {
  case state(name: String, messages: [ChatMessage], running: Bool, parts: [Part], preview: PreviewState, publish: PublishState)
  case runStart
  case runEnd
  case textDelta(String)
  case part(Part)
  case step(Step)
  case message(ChatMessage)
  case preview(PreviewState)
  case publish(PublishState)
  case frameClear
  case filesChanged
  case renamed(String)
  case unknown

  nonisolated private enum CodingKeys: String, CodingKey {
    case type, project, messages, running, parts, preview, publish, delta, part, step, message, name
  }

  nonisolated private struct ProjectInfo: Decodable { let name: String }

  init(from decoder: any Decoder) throws {
    let box = try decoder.container(keyedBy: CodingKeys.self)
    switch try box.decode(String.self, forKey: .type) {
    case "state":
      self = .state(
        name: try box.decode(ProjectInfo.self, forKey: .project).name,
        messages: try box.decode([ChatMessage].self, forKey: .messages),
        running: try box.decode(Bool.self, forKey: .running),
        parts: try box.decode([Part].self, forKey: .parts),
        preview: try box.decode(PreviewState.self, forKey: .preview),
        // Older servers do not send this.
        publish: try box.decodeIfPresent(PublishState.self, forKey: .publish) ?? .none
      )
    case "run.start": self = .runStart
    case "run.end": self = .runEnd
    case "text.delta": self = .textDelta(try box.decode(String.self, forKey: .delta))
    case "part": self = .part(try box.decode(Part.self, forKey: .part))
    case "step": self = .step(try box.decode(Step.self, forKey: .step))
    case "message": self = .message(try box.decode(ChatMessage.self, forKey: .message))
    case "preview": self = .preview(try box.decode(PreviewState.self, forKey: .preview))
    case "publish": self = .publish(try box.decode(PublishState.self, forKey: .publish))
    case "frame.clear": self = .frameClear
    case "files.changed": self = .filesChanged
    case "project": self = .renamed(try box.decode(String.self, forKey: .name))
    default: self = .unknown
    }
  }
}
