// How much of what is under the hood the person is shown. Mirrors shared/level.ts.
//
// Everyone starts at the first level, where nothing is said about how an app is made. The server
// reads what the person writes to the builder and what they do, and says so in its answers when it
// is time to show more: first what the builder does and Apple's own words, then the code and the ids.
import SwiftUI

/// What the server says about the level. 1: only what is needed. 2: what the builder does, and
/// Apple's own words. 3: the code and everything else.
nonisolated struct LevelState: Decodable, Equatable {
  var level: Int
  /// The person's own choice, or nil while the level follows what they write and do.
  var chosen: Int?
  /// True when the level has gone up by itself and the person has not been told yet.
  var fresh: Bool
  /// True when the person has asked about Google Play or Android, which there is an honest answer to.
  var play: Bool?

  static let first = LevelState(level: 1, chosen: nil, fresh: false, play: false)

  /// The level in an answer from the server, wherever it is; nil when the answer has none.
  static func read(from answer: Data) -> LevelState? {
    struct Carrier: Decodable {
      struct Person: Decodable { let level: LevelState? }
      let level: LevelState?
      let user: Person?
    }
    // Most answers say nothing about it, and are not read twice for nothing.
    guard answer.range(of: Data("\"level\"".utf8)) != nil, let carrier = try? JSONDecoder().decode(Carrier.self, from: answer) else { return nil }
    guard var found = carrier.level ?? carrier.user?.level else { return nil }
    found.level = min(3, max(1, found.level))
    return found
  }
}

/// The level the person is shown right now. One for the whole app: the server's answers keep it current.
@Observable
final class Depth {
  static let shared = Depth()

  private(set) var state = LevelState.first
  /// False against a server without levels, or with them turned off: nothing about them is then shown.
  private(set) var isOn = false

  var level: Int { state.level }
  /// What the builder does, and Apple's own words.
  var showsMore: Bool { state.level >= 2 }
  /// The code and the ids.
  var showsAll: Bool { state.level >= 3 }
  var askedAboutPlay: Bool { state.play == true }

  func note(answer: Data) {
    guard let found = LevelState.read(from: answer) else { return }
    isOn = true
    if found != state { state = found }
  }

  /// Signed out: the next person starts from the beginning.
  func forget() {
    state = .first
    isOn = false
  }
}

// MARK: - The note that more is shown now

/// Said the one time the level goes up by itself: what is new, and a way straight back for someone
/// who would rather not have it.
struct LevelNote: View {
  let api: API

  @State private var isBusy = false

  private var depth: Depth { .shared }

  var body: some View {
    if depth.state.fresh, depth.level > 1 {
      HStack(alignment: .top, spacing: 14) {
        Mascot(isCheering: true)
          .frame(width: 54)
        VStack(alignment: .leading, spacing: 6) {
          Group {
            if depth.showsAll {
              Text("Du pratar som en utvecklare")
            } else {
              Text("Du verkar kunna det här")
            }
          }
          .font(.headline)
          Group {
            if depth.showsAll {
              Text("Så nu visar vi allt: koden, alla id:n, och en byggare som pratar teknik med dig.")
            } else {
              Text("Så nu visar vi lite mer: vad byggaren gör steg för steg, och vad Apple svarar ord för ord.")
            }
          }
          .font(.subheadline)
          .fixedSize(horizontal: false, vertical: true)
          Text("Du ändrar det när du vill under Mitt konto.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
          HStack(spacing: 10) {
            Button("Bra, visa det") { answer(keeps: true) }
              .buttonStyle(.borderedProminent)
            Button("Nej, visa mindre") { answer(keeps: false) }
              .buttonStyle(.bordered)
          }
          .font(.subheadline.weight(.semibold))
          .buttonBorderShape(.capsule)
          .disabled(isBusy)
          .padding(.top, 4)
        }
      }
      .padding(16)
      .background(.regularMaterial, in: .rect(cornerRadius: 24, style: .continuous))
      .shadow(color: .black.opacity(0.12), radius: 18, y: 6)
      .padding(.horizontal, 12)
      .padding(.bottom, 8)
      .transition(.move(edge: .bottom).combined(with: .opacity))
      .accessibilityElement(children: .contain)
    }
  }

  /// Either answer means the note has been read; "less" also puts the person back where they were.
  private func answer(keeps: Bool) {
    isBusy = true
    let below = depth.level - 1
    Task {
      defer { isBusy = false }
      // Asked again the next time something is loaded, should this not get through.
      if keeps { try? await api.levelSeen() } else { try? await api.chooseLevel(below) }
    }
  }
}

// MARK: - The person's own choice

/// In the account: follow along, or one of the three levels.
struct LevelChoice: View {
  let api: API

  @State private var isBusy = false

  private var depth: Depth { .shared }

  static func name(_ level: Int) -> String {
    switch level {
    case 3: String(localized: "Allt")
    case 2: String(localized: "Mer")
    default: String(localized: "Enkelt")
    }
  }

  var body: some View {
    Section {
      row(nil, title: String(localized: "Välj åt mig"), about: depth.state.chosen == nil ? String(localized: "Just nu: \(Self.name(depth.level))") : nil)
      row(1, title: Self.name(1), about: String(localized: "Bara det du behöver för att göra din app."))
      row(2, title: Self.name(2), about: String(localized: "Också vad byggaren gör steg för steg, och Apples egna ord."))
      row(3, title: Self.name(3), about: String(localized: "Också koden, alla id:n och det tekniska."))
    } header: {
      Text("Hur mycket vill du se?")
    } footer: {
      Text("Vi visar mer när vi märker att du vill ha det. Du kan också välja själv.")
    }
    .disabled(isBusy)
  }

  private func row(_ value: Int?, title: String, about: String?) -> some View {
    Button {
      isBusy = true
      Task {
        defer { isBusy = false }
        try? await api.chooseLevel(value)
      }
    } label: {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          // The colours are named outright: inside a button, primary and secondary are shades of the tint.
          Text(title)
            .foregroundStyle(Color.primary)
          if let about {
            Text(about)
              .font(.footnote)
              .foregroundStyle(Color.secondary)
          }
        }
        Spacer()
        if depth.state.chosen == value {
          Image(systemName: "checkmark")
            .fontWeight(.semibold)
        }
      }
      .contentShape(.rect)
    }
    .accessibilityAddTraits(depth.state.chosen == value ? .isSelected : [])
  }
}

// MARK: - The builder's steps

/// The steps the builder took, folded away under a line that says how many: for the people who are
/// shown more than the first level. Those shown everything get the names of the files as well.
struct StepsFold: View {
  let parts: [Part]

  @State private var isOpen = false

  /// What the builder says along the way is shown where it is said, not as a step.
  private var steps: [Step] {
    parts.compactMap { part in
      if case .step(let step) = part, step.kind != .say, step.kind != .other { step } else { nil }
    }
  }

  var body: some View {
    let steps = steps
    if Depth.shared.showsMore, !steps.isEmpty {
      DisclosureGroup(isExpanded: $isOpen) {
        VStack(alignment: .leading, spacing: 4) {
          ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
            HStack(alignment: .firstTextBaseline, spacing: 6) {
              Text(verbatim: "\(index + 1).")
                .monospacedDigit()
                .foregroundStyle(.tertiary)
              Text(StepText.line(step, named: Depth.shared.showsAll))
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
      } label: {
        Text("Så gjorde byggaren · \(steps.count) steg")
      }
      .font(.footnote)
      .foregroundStyle(.secondary)
      .tint(.secondary)
      .padding(.horizontal, 4)
    }
  }
}

/// A step in words. `named`: with the file's name, for the people who are shown everything.
nonisolated enum StepText {
  static func line(_ step: Step, named: Bool) -> AttributedString {
    let name = step.detail.trimmingCharacters(in: .whitespacesAndNewlines)
    var line: AttributedString
    if named, !name.isEmpty, step.kind != .build, step.kind != .look, step.kind != .icon {
      let file = name.hasPrefix("Sources/") ? String(name.dropFirst("Sources/".count)) : name
      var shown = AttributedString(file)
      // A file is named the way it is written; the app's name is a name like any other.
      if step.kind != .rename { shown.font = .footnote.monospaced() }
      line = AttributedString(verb(step.kind) + " ") + shown
    } else {
      line = AttributedString(plain(step.kind))
    }
    switch step.status {
    case .error:
      var failed = AttributedString(" · " + String(localized: "gick inte"))
      failed.foregroundColor = .red
      line += failed
    case .running:
      line += AttributedString(" · " + String(localized: "pågår"))
    case .done:
      break
    }
    return line
  }

  static func plain(_ kind: Step.Kind) -> String {
    switch kind {
    case .write: String(localized: "Skrev en ny del")
    case .edit: String(localized: "Ändrade en del")
    case .delete: String(localized: "Tog bort en del")
    case .read: String(localized: "Läste en del")
    case .build: String(localized: "Byggde och startade appen")
    case .look: String(localized: "Tittade på skärmen")
    case .rename: String(localized: "Gav appen ett namn")
    case .icon: String(localized: "Ritade ikonen")
    case .say, .other: ""
    }
  }

  /// What was done to the file that is named after it.
  static func verb(_ kind: Step.Kind) -> String {
    switch kind {
    case .write: String(localized: "Skrev")
    case .edit: String(localized: "Ändrade")
    case .delete: String(localized: "Tog bort")
    case .read: String(localized: "Läste")
    case .rename: String(localized: "Döpte appen till")
    case .build, .look, .icon, .say, .other: ""
    }
  }
}
