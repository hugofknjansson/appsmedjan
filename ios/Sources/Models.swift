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
  /// When the app's icon last changed, or nil while it has none (or the server is from before icons were always made).
  var icon: Double?

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
    /// say: the builder telling the person, in a few plain words, what it is making right now.
    case write, edit, delete, read, build, look, rename, icon, say, other
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

/// How far the builder has come, read off the steps it has taken so far: clues for the person who
/// waits. The same reckoning as `runProgress` on the server's side.
nonisolated struct RunProgress: Equatable {
  nonisolated enum Phase { case thinking, making, drawing, trying, fixing, looking }

  var phase = Phase.thinking
  /// How many pieces of the app have been written or changed so far.
  var pieces = 0
  /// How far along the whole run is, between 0 and 1: a guess that only ever grows within a run.
  var fraction = 0.05

  init(parts: [Part]) {
    // What the builder says along the way is not work of its own.
    let steps: [Step] = parts.compactMap { part in
      if case .step(let step) = part, step.kind != .say { step } else { nil }
    }
    pieces = steps.count { ($0.kind == .write || $0.kind == .edit) && $0.status != .running }
    let tries = steps.count { $0.kind == .build }
    if let latest = steps.last {
      switch latest.kind {
      case .build: phase = latest.status == .error ? .fixing : .trying
      case .look: phase = .looking
      case .icon: phase = .drawing
      // Writing again after a try that did not work is fixing, until the next try.
      default: phase = steps.last { $0.kind == .build }?.status == .error ? .fixing : .making
      }
    }
    // Up to half for the writing (eight pieces count as plenty), then a share for each try. Never full:
    // the run is over when the server says so.
    let written = 0.5 * min(1, Double(pieces) / 8)
    let tried = tries == 0 ? 0 : 0.25 + 0.15 * min(1, Double(tries - 1) / 3)
    fraction = min(0.92, 0.05 + written + tried)
  }
}

nonisolated extension [Part] {
  /// What the builder has said it is making, oldest first.
  var said: [String] {
    compactMap { part in
      guard case .step(let step) = part, step.kind == .say else { return nil }
      let text = step.detail.trimmingCharacters(in: .whitespacesAndNewlines)
      return text.isEmpty ? nil : text
    }
  }
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
  /// False when a moving finger is to be sent where it is, not where it is heading. Missing from
  /// servers that have no say in it, which means where it is heading.
  var predictFinger: Bool?

  static let idle = PreviewState(status: .idle, stage: nil, mime: "image/jpeg", canInput: false)
}

/// Something done to the app in the simulator. Positions are 0...1 of the screen.
nonisolated enum InputEvent: Encodable, Equatable {
  /// A finger on the screen, sent as it moves, so that what is under it can follow.
  case touch(Phase, x: Double, y: Double)
  case tap(x: Double, y: Double)
  case swipe(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Int)
  case text(String)
  case key(Key)
  case home

  nonisolated enum Key: String, Encodable { case backspace, enter }
  nonisolated enum Phase: String, Encodable { case down, move, up }

  nonisolated private enum CodingKeys: String, CodingKey { case kind, phase, x, y, x1, y1, x2, y2, durationMs, text, key, button }

  func encode(to encoder: any Encoder) throws {
    var box = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .touch(let phase, let x, let y):
      try box.encode("touch", forKey: .kind)
      try box.encode(phase, forKey: .phase)
      try box.encode(x, forKey: .x)
      try box.encode(y, forKey: .y)
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
  /// The public TestFlight link for installing the app. Missing from servers before it existed.
  var test: TestLink?
  /// The fast way for people on the operator's account. Missing from servers before it existed.
  var fast: FastTrack?
  /// True when the signed-in person runs the service, and so creates apps in App Store Connect.
  var `operator`: Bool?
  /// Installing straight onto the person's own phone. Missing from servers before it existed.
  var direct: DirectInstall?
  /// What the owner's plan allows. Missing from servers before plans existed, where everything is open.
  var plan: PlanAccess?

  static let none = PublishState(available: false, account: .none, canConnect: false, status: .idle)
}

/// What the open project needs to know about the plan, to ask for the right thing at the right moment.
nonisolated struct PlanAccess: Decodable, Equatable {
  var id: String
  var install: Bool
  var store: Bool
}

/// What a plan holds.
nonisolated struct PlanLimits: Decodable, Equatable {
  var apps: Int
  var messages: Int
  var install: Bool
  var store: Bool
}

/// The person's plan: what it holds, how much of it is used, and what they have asked for.
/// There is no payment yet: a person asks for a plan and the people who run the service give it.
nonisolated struct PlanState: Decodable, Equatable {
  nonisolated struct Used: Decodable, Equatable {
    var apps: Int
    var messages: Int
  }

  /// From the smallest plan to the largest.
  static let order = ["free", "create", "publish"]

  /// False while plans are not turned on: everything is open to everyone.
  var enforced: Bool
  var plan: String
  var limits: PlanLimits
  var used: Used
  /// A larger plan the person has asked for and not been given yet.
  var requested: String?
  /// When the month's count of messages starts over, in milliseconds since 1970.
  var resetsAt: Double
  /// Every plan by its id, for showing what a larger one would give.
  var plans: [String: PlanLimits]
  /// True when the person stands in front of the paywall: their plan lets them build nothing.
  var locked: Bool?
  /// Whether a code can be given in place of paying.
  var takesCode: Bool?
  /// What each plan costs, in the operator's own words, for the plans that have a price.
  var prices: [String: String]?

  var isLocked: Bool { locked == true }

  var resets: Date { Date(timeIntervalSince1970: resetsAt / 1000) }

  func isLarger(_ id: String) -> Bool {
    (Self.order.firstIndex(of: id) ?? 0) > (Self.order.firstIndex(of: plan) ?? 0)
  }
}

/// Straight onto the phone, without TestFlight: the person adds their phone once, and after that
/// every build is signed for it and installed from a link.
nonisolated struct DirectInstall: Decodable, Equatable {
  nonisolated enum Status: String, LenientEnum {
    case idle, working, ready, failed
    static let fallback = Status.idle
  }

  var available: Bool
  /// How many phones the person has added, and how many they may add.
  var phones: Int
  var maxPhones: Int
  var status: Status
  var stage: String?
  var error: String?
  /// Path of the page with the install button, once a build is ready.
  var path: String?
  /// How far this phone has come with fetching the ready build: asked, fetching or fetched.
  var install: String?
  /// True when the ready build is of the app as it is now. Nil from servers that do not say.
  var fresh: Bool?

  /// Whether there is anything to show: the server offers it, or the person has used it before.
  var isShown: Bool { available || phones > 0 || status != .idle }
}

/// A public TestFlight link: anyone who opens it can install the app, without a developer account.
nonisolated struct TestLink: Decodable, Equatable {
  nonisolated enum Status: String, LenientEnum {
    case none, working, processing, review, approved, rejected, failed
    case needsContact = "needs_contact"
    static let fallback = Status.none
  }

  var status: Status
  /// The address to open. Only useful once the status is approved.
  var url: String?
  var build: String?
  var error: String?
  var detail: String?
}

/// The fast way onto a phone: an invitation to the operator's team as an internal tester.
nonisolated struct FastTrack: Decodable, Equatable {
  nonisolated enum Status: String, LenientEnum {
    case none, working, invited, added, failed
    static let fallback = Status.none
  }

  var available: Bool
  var status: Status
  var email: String?
  var error: String?
  var detail: String?
}

/// Who to invite: the email of their Apple Account and their name.
nonisolated struct TesterPerson: Encodable, Equatable {
  var email = ""
  var firstName = ""
  var lastName = ""

  var isComplete: Bool {
    !firstName.trimmingCharacters(in: .whitespaces).isEmpty
      && !lastName.trimmingCharacters(in: .whitespaces).isEmpty
      && email.trimmingCharacters(in: .whitespaces).wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) != nil
  }
}

// MARK: - App Store page

/// The texts and links of the app's page on the App Store.
nonisolated struct StoreListing: Codable, Equatable {
  var name = ""
  var subtitle = ""
  var promo = ""
  var description = ""
  var keywords = ""
  var supportUrl = ""
  var marketingUrl = ""
  var privacyUrl = ""
  var category = ""

  /// Apple's limits, in characters.
  nonisolated enum Limit {
    static let name = 30
    static let subtitle = 30
    static let promo = 170
    static let description = 4000
    static let keywords = 100
    static let policy = 12_000
  }
}

/// What the person states about the app. Each is only acted on when it is true.
nonisolated struct StoreChoices: Codable, Equatable {
  var noMatureContent = false
  var noThirdPartyContent = false
  var free = true
}

/// A support page and a privacy policy shown by the service, for people without a website of their own.
nonisolated struct StorePages: Codable, Equatable {
  var hosted = false
  var supportEmail = ""
  var privacyText = ""
  var lang = "en"
}

/// Who Apple's reviewers can reach about the app. Kept per person, used for all their apps.
nonisolated struct ReviewContact: Codable, Equatable {
  var firstName = ""
  var lastName = ""
  var phone = ""
  var email = ""
  var holder = ""

  /// The first thing that keeps the details from being used, or nil when they are complete.
  var problem: Problem? {
    if firstName.trimmingCharacters(in: .whitespaces).isEmpty || lastName.trimmingCharacters(in: .whitespaces).isEmpty { return .name }
    if phone.trimmingCharacters(in: .whitespaces).wholeMatch(of: /\+[0-9][0-9 ()\-]{6,24}/) == nil { return .phone }
    if email.trimmingCharacters(in: .whitespaces).wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) == nil { return .email }
    return nil
  }

  nonisolated enum Problem { case name, phone, email }
}

/// Everything the App Store guide shows, as the server holds it.
nonisolated struct StoreState: Decodable, Equatable {
  nonisolated struct Progress: Decodable, Equatable {
    nonisolated enum Status: String, LenientEnum {
      case idle, working, done, failed
      static let fallback = Status.idle
    }

    var status: Status
    var stage: String?
    var error: String?
    var detail: String?
    /// attached, processing or none: whether the uploaded build is selected for the version.
    var attached: String?
  }

  var listing: StoreListing
  /// Ids of the saved screenshots, in display order.
  var screenshots: [String]
  var hasIcon: Bool
  var canCapture: Bool
  var available: Bool
  var account: PublishState.Account
  /// Codes for what stops the page from being sent ("name_missing", "screenshots").
  var problems: [String]
  var build: String?
  var choices: StoreChoices
  var pages: StorePages
  var contact: ReviewContact
  var canSubmit: Bool
  var submit: Progress
  var sync: Progress
}

/// A suggestion for the page's texts, written from the app's code.
nonisolated struct StoreDraft: Decodable {
  nonisolated struct Texts: Decodable {
    var name: String?
    var subtitle: String?
    var promo: String?
    var description: String?
    var keywords: String?
    var category: String?
  }

  var draft: Texts
  var ageRatingNotes: [String]
  var privacyPolicy: String
}

// MARK: - The person's own Apple developer account

nonisolated struct AppleStatus: Decodable, Equatable {
  var enabled: Bool
  var connected: Bool
  var teamId: String?
  var keyId: String?
}

/// An app someone is waiting for the operator to create in App Store Connect.
nonisolated struct AppRequest: Decodable, Identifiable, Equatable {
  var projectId: String
  var name: String
  var bundleId: String
  var email: String

  var id: String { projectId }
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
