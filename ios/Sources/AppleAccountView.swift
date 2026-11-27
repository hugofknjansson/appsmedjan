// Connecting the person's own Apple developer account, so that their apps are put up in their name.
//
// A guide that takes one step at a time, for someone who has never seen Apple's developer pages:
// whether they have an account, getting a key from Apple (with a moving picture of where to press),
// choosing the key file, and pasting one code. The key's id is read off the file's name and the team
// is found by the server, so those are asked for only when that fails. The same thing with every
// field on one page is in AppleAccountClassicView.swift, a press away.
import SwiftUI
import UniformTypeIdentifiers

struct AppleAccountView: View {
  let api: API

  /// A developer knows what a Key ID is: they get every field at once, with the guide a press away.
  @State private var isClassic = Depth.shared.showsAll

  var body: some View {
    if isClassic {
      AppleAccountClassicView(api: api) { isClassic = false }
    } else {
      AppleGuide(api: api) {
        isClassic = true
        // Choosing every field at once says something about how used to this the person is.
        Task { try? await api.levelAct("classic") }
      }
    }
  }
}

/// What can be read off the things Apple hands out with a key, so that the person types as little as possible.
nonisolated enum AppleKey {
  /// The code Apple calls Issuer ID, wherever it is in what was typed or pasted.
  static func issuerID(in text: String) -> String? {
    text.firstMatch(of: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/).map { String($0.0).lowercased() }
  }

  /// The key's id, which Apple puts in the name of the file: "AuthKey_ABC123DEFG.p8". Nil when the file has been renamed.
  static func keyID(fromFileName name: String) -> String? {
    name.firstMatch(of: /AuthKey_([A-Za-z0-9]+)\.p8$/).map { String($0.1).uppercased() }
  }
}

private struct AppleGuide: View {
  enum Step: Hashable {
    case have, join, key, file, code, team, checking, done

    /// The three steps that are counted: the rest are questions before them and what happens after.
    static let counted: [Step] = [.key, .file, .code]
  }

  let api: API
  /// Shows every field on one page instead.
  let onClassic: () -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var status: AppleStatus?
  @State private var step = Step.have
  @State private var key = ""
  @State private var fileName = ""
  @State private var keyID = ""
  /// Apple names the file after the key. When the name has been changed, the id is asked for.
  @State private var asksKeyID = false
  /// True when the key's id was read off the file's name.
  @State private var keyIDFromName = false
  @State private var issuerID = ""
  @State private var teamID = ""
  /// The person has been sent to Apple's key page: what to press next is that they have the file.
  @State private var hasOpenedApple = false
  @State private var isPickingFile = false
  @State private var isConfirmingDisconnect = false
  @State private var isBusy = false
  @State private var errorText: String?
  @State private var hint: String?
  @State private var cheers = 0
  @State private var ticks = 0
  /// Which team and key: open from the start for the people who are shown more than the first level.
  @State private var showsLinkedDetails = Depth.shared.showsMore

  private static let developerApp = URL(string: "https://apps.apple.com/app/apple-developer/id640199958")!
  private static let keys = URL(string: "https://appstoreconnect.apple.com/access/integrations/api")!
  private static let membership = URL(string: "https://developer.apple.com/account#MembershipDetailsCard")!

  private var code: String? { AppleKey.issuerID(in: issuerID) }
  private var canConnect: Bool {
    !key.isEmpty && code != nil && !keyID.trimmingCharacters(in: .whitespaces).isEmpty
  }

  /// What is on the screen now, as one value: when it changes, the old step leaves and the new one arrives.
  private var page: String {
    guard let status else { return "loading" }
    if step == .done { return "done" }
    if status.connected { return "linked" }
    if !status.enabled { return "off" }
    return String(describing: step)
  }

  /// True while the person is being led through the steps, which is when the other way in is offered.
  private var isGuiding: Bool {
    guard let status, status.enabled, !status.connected else { return false }
    return step != .done && step != .checking
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          if isGuiding, let index = Step.counted.firstIndex(of: step) {
            StepDots(count: Step.counted.count, index: index)
          }
          // One on top of the other while they swap, so the page does not jump.
          ZStack(alignment: .top) {
            content
              .id(page)
              .transition(.rise)
          }
          if let errorText, page == "loading" || page == "off" {
            Text(errorText)
              .font(.footnote)
              .foregroundStyle(.red)
          }
          if isGuiding {
            Button("Fyll i allt på en gång", action: onClassic)
              .font(.footnote.weight(.semibold))
          }
        }
        .padding()
        .animation(Motion.arrive(reduced: reduceMotion), value: page)
      }
      .scrollDismissesKeyboard(.interactively)
      .paperBackground()
      .navigationTitle("Koppla ditt Apple-konto")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
      }
      .task { await load() }
      .fileImporter(isPresented: $isPickingFile, allowedContentTypes: [.data, .text]) { result in
        if case .success(let url) = result { read(url) }
      }
    }
    .overlay { Confetti(trigger: cheers) }
    .sensoryFeedback(.success, trigger: cheers)
    .sensoryFeedback(.selection, trigger: ticks)
  }

  @ViewBuilder
  private var content: some View {
    if let status {
      if step == .done {
        done
      } else if status.connected {
        linked
      } else if !status.enabled {
        Text("Koppling av egna Apple-konton är inte påslagen här.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .card()
      } else {
        switch step {
        case .have: have
        case .join: join
        case .key: getKey
        case .file: chooseFile
        case .code: pasteCode
        case .team: giveTeam
        case .checking, .done: checking
        }
      }
    } else if errorText == nil {
      Waiting()
    }
  }

  // MARK: - The steps

  private var have: some View {
    VStack(spacing: 14) {
      Mascot(isWaving: true)
        .frame(width: 120)
      heading("Har du ett utvecklarkonto hos Apple?", centred: true)
      Text("Det är kontot som låter dig lägga upp appar i App Store, i ditt eget namn. Apple tar 99 dollar per år för det.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("Ja, det har jag") { go(.key) }
        .buttonStyle(.bouncy)
      Button("Nej, inte än") { go(.join) }
        .buttonStyle(.soft)
    }
    .card(padding: 22)
  }

  private var join: some View {
    VStack(alignment: .leading, spacing: 14) {
      heading("Skaffa kontot först")
      Numbered(lines: [
        String(localized: "Tryck på knappen och hämta Apples app Developer."),
        String(localized: "Öppna den, tryck på Account och sedan på Enroll Now. Välj att gå med som privatperson."),
        String(localized: "Apple godkänner dig, oftast inom ett par dagar, och mejlar när det är klart."),
      ])
      Button("Hämta Apples app") { openURL(Self.developerApp) }
        .buttonStyle(.bouncy)
      Button("Jag har kontot nu") { go(.key) }
        .buttonStyle(.soft)
      back(to: .have)
    }
    .card(padding: 22)
  }

  private var getKey: some View {
    VStack(alignment: .leading, spacing: 14) {
      heading("Hämta en nyckel hos Apple")
      Text("Nyckeln är en liten fil som låter App Dance lägga upp dina appar åt dig. Gör så här på Apples sida:")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      KeyPicture()
      Numbered(lines: [
        String(localized: "Tryck på Generate API Key, eller på plus om du har nycklar sedan förut."),
        String(localized: "Skriv App Dance som namn och välj Admin."),
        String(localized: "Tryck på Download. Det går bara en gång, så spara filen."),
      ])
      Text("Ser du knappen Request Access? Tryck på den först.")
        .font(.footnote)
        .foregroundStyle(.secondary)
      problem
      // First the way to Apple; once the person has been there, on is the thing to press.
      if hasOpenedApple {
        Button("Jag har filen") { go(.file) }
          .buttonStyle(.bouncy)
        Button("Öppna Apples sida igen") { openURL(Self.keys) }
          .buttonStyle(.soft)
      } else {
        Button("Öppna Apples sida") {
          openURL(Self.keys)
          hasOpenedApple = true
        }
        .buttonStyle(.bouncy)
        Button("Jag har filen") { go(.file) }
          .buttonStyle(.soft)
      }
      back(to: .have)
    }
    .card(padding: 22)
  }

  private var chooseFile: some View {
    VStack(alignment: .leading, spacing: 14) {
      heading("Välj filen")
      Text("Den heter AuthKey och ligger bland dina hämtade filer. Den brukar stå överst under Senaste.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Button {
        isPickingFile = true
      } label: {
        VStack(spacing: 8) {
          Image(systemName: key.isEmpty ? "doc.badge.plus" : "checkmark.circle.fill")
            .font(.system(size: 40, weight: .semibold))
            .foregroundStyle(key.isEmpty ? Color.brand : .green)
            .contentTransition(.symbolEffect(.replace))
            .accessibilityHidden(true)
          Text(key.isEmpty ? "Tryck här för att välja filen" : "Rätt fil. Snyggt!")
            .font(.headline)
            .foregroundStyle(.primary)
          Text(verbatim: key.isEmpty ? "AuthKey_….p8" : fileName)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 150)
        .background(Color(.paper), in: .rect(cornerRadius: 18, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 18, style: .continuous)
            .strokeBorder(key.isEmpty ? Color.brand.opacity(0.6) : .green, style: StrokeStyle(lineWidth: 2, dash: key.isEmpty ? [7, 6] : []))
        }
      }
      .buttonStyle(.pop)
      .animation(Motion.swap, value: key.isEmpty)
      problem
      if !key.isEmpty {
        Button("Vidare") { go(.code) }
          .buttonStyle(.bouncy)
      }
      back(to: .key)
    }
    .card(padding: 22)
  }

  private var pasteCode: some View {
    VStack(alignment: .leading, spacing: 14) {
      heading("Sista steget: kopiera en kod")
      Text("På samma sida hos Apple står Issuer ID ovanför listan med nycklar. Tryck på Copy bredvid, och klistra in koden här.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      CodePicture()
      HStack(spacing: 10) {
        TextField(text: Binding(get: { issuerID }, set: { take(code: $0) }), prompt: Text(verbatim: "xxxxxxxx-xxxx-xxxx-…")) {
          Text(verbatim: "Issuer ID")
        }
        .font(.footnote.monospaced())
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        if code != nil {
          Image(systemName: "checkmark.circle.fill")
            .font(.title2)
            .foregroundStyle(.green)
            .transition(.scale(scale: 0.6).combined(with: .opacity))
            .accessibilityHidden(true)
        } else {
          // The system's own paste button: it reads what is copied without iOS asking first.
          PasteButton(payloadType: String.self) { @Sendable copied in
            Task { @MainActor in paste(copied.first ?? "") }
          }
          .buttonBorderShape(.capsule)
          .tint(.brand)
        }
      }
      .padding(.leading, 14)
      .padding(.trailing, 8)
      .frame(minHeight: 52)
      .background(Color(.paper), in: .rect(cornerRadius: 16, style: .continuous))
      .overlay {
        if code != nil { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.green, lineWidth: 2) }
      }
      .animation(Motion.swap, value: code != nil)
      if code != nil {
        Text("Koden ser rätt ut.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      } else if let hint {
        Text(hint)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if asksKeyID {
        VStack(alignment: .leading, spacing: 6) {
          Text("Nyckelns Key ID")
            .font(.subheadline.weight(.semibold))
          TextField(text: $keyID) { Text(verbatim: "Key ID") }
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Color(.paper), in: .rect(cornerRadius: 14, style: .continuous))
          // Asked for either because the file's name did not give it, or because Apple said no to what it gave.
          Text(keyIDFromName ? "Det ska vara samma som står på nyckelns rad hos Apple." : "Filen har bytt namn, så vi kan inte läsa av det. Det står på nyckelns rad hos Apple.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      problem
      Button("Koppla kontot") { connect(from: .code) }
        .buttonStyle(.bouncy)
        .disabled(!canConnect)
      privacy
      back(to: .file)
    }
    .card(padding: 22)
  }

  private var giveTeam: some View {
    VStack(alignment: .leading, spacing: 14) {
      heading("En sak till")
      Text("Apple visade inte vilket team kontot har. Det står under Membership details, tio tecken långt.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Button("Öppna sidan hos Apple") { openURL(Self.membership) }
        .font(.subheadline.weight(.semibold))
      TextField(text: $teamID) { Text(verbatim: "Team ID") }
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .background(Color(.paper), in: .rect(cornerRadius: 14, style: .continuous))
      problem
      Button("Koppla kontot") { connect(from: .team) }
        .buttonStyle(.bouncy)
        .disabled(!canConnect || teamID.trimmingCharacters(in: .whitespaces).isEmpty)
      privacy
      back(to: .code)
    }
    .card(padding: 22)
  }

  private var checking: some View {
    VStack(spacing: 14) {
      Mascot(isDancing: true)
        .frame(width: 120)
      WaitingCaption(lines: WaitingLines.checking, every: 2.2)
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .card(padding: 28)
    .accessibilityElement(children: .combine)
  }

  private var done: some View {
    VStack(spacing: 14) {
      Mascot(isCheering: true)
        .frame(width: 120)
      heading("Klart! Ditt Apple-konto är kopplat.", centred: true)
      Text("Nu läggs dina appar upp i ditt eget namn.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("Klar") { dismiss() }
        .buttonStyle(.bouncy)
    }
    .card(padding: 22)
  }

  /// The account is connected already: that it is, and a way to undo it. Which team and key is behind a press.
  private var linked: some View {
    VStack(alignment: .leading, spacing: 14) {
      Label("Ditt Apple-konto är kopplat.", systemImage: "checkmark.circle.fill")
        .font(.headline)
        .symbolRenderingMode(.multicolor)
      Text("Dina appar läggs upp i ditt eget namn.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      if let status {
        DisclosureGroup("Visa detaljer", isExpanded: $showsLinkedDetails) {
          Text("Team \(status.teamId ?? ""), nyckel \(status.keyId ?? "")")
            .font(.footnote.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
        }
        .font(.footnote.weight(.semibold))
        .tint(.secondary)
      }
      problem
      Button("Klar") { dismiss() }
        .buttonStyle(.bouncy)
      Button("Koppla från", role: .destructive) { isConfirmingDisconnect = true }
        .font(.subheadline.weight(.semibold))
        .frame(maxWidth: .infinity)
        .disabled(isBusy)
        .confirmationDialog("Koppla från ditt Apple-konto?", isPresented: $isConfirmingDisconnect, titleVisibility: .visible) {
          Button("Koppla från", role: .destructive) { disconnect() }
        } message: {
          Text("Nyckeln raderas här. Appar som redan är uppladdade påverkas inte.")
        }
    }
    .card(padding: 22)
  }

  // MARK: - Pieces

  private func heading(_ text: LocalizedStringKey, centred: Bool = false) -> some View {
    Text(text)
      .font(.title3.weight(.bold))
      .multilineTextAlignment(centred ? .center : .leading)
      .frame(maxWidth: .infinity, alignment: centred ? .center : .leading)
      .accessibilityAddTraits(.isHeader)
  }

  @ViewBuilder
  private var problem: some View {
    if let errorText {
      Text(errorText)
        .font(.footnote.weight(.medium))
        .foregroundStyle(.red)
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity)
    }
  }

  private var privacy: some View {
    Text("Nyckeln sparas krypterad och används bara för att lägga upp dina appar. Du kan när som helst koppla från här.")
      .font(.footnote)
      .foregroundStyle(.secondary)
  }

  private func back(to step: Step) -> some View {
    Button("Tillbaka", systemImage: "chevron.left") { go(step) }
      .font(.footnote.weight(.semibold))
      .foregroundStyle(.secondary)
  }

  // MARK: - Doing

  private func go(_ to: Step) {
    errorText = nil
    hint = nil
    step = to
  }

  private func load() async {
    do throws(APIError) {
      status = try await api.appleAccount()
    } catch {
      errorText = Texts.apiError(error.code)
    }
  }

  /// Reads the key file. Apple names it after the key, which gives the key's id.
  private func read(_ url: URL) {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    guard let data = try? Data(contentsOf: url), data.count <= 4000, let text = String(data: data, encoding: .utf8), text.contains("PRIVATE KEY") else {
      key = ""
      fileName = ""
      errorText = String(localized: "Det där är inte nyckelfilen från Apple. Den heter AuthKey_… och slutar på .p8.")
      return
    }
    errorText = nil
    key = text
    fileName = url.lastPathComponent
    let fromName = AppleKey.keyID(fromFileName: url.lastPathComponent)
    keyID = fromName ?? ""
    asksKeyID = fromName == nil
    keyIDFromName = fromName != nil
    ticks += 1
    // A moment to see that the file was the right one, then on to the next step.
    Task {
      try? await Task.sleep(for: .seconds(0.9))
      if step == .file, !key.isEmpty { go(.code) }
    }
  }

  private func take(code text: String) {
    hint = nil
    issuerID = AppleKey.issuerID(in: text) ?? text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func paste(_ copied: String) {
    errorText = nil
    if let found = AppleKey.issuerID(in: copied) {
      issuerID = found
      hint = nil
      ticks += 1
    } else {
      hint = String(localized: "Det du har kopierat ser inte ut som koden. Tryck på Copy bredvid Issuer ID hos Apple och försök igen.")
    }
  }

  private func connect(from: Step) {
    guard canConnect, let code else { return }
    go(.checking)
    Task {
      do throws(APIError) {
        status = try await api.connectApple(
          key: key,
          keyID: keyID.trimmingCharacters(in: .whitespaces),
          issuerID: code,
          teamID: teamID.trimmingCharacters(in: .whitespaces)
        )
        key = ""
        step = .done
        cheers += 1
      } catch {
        // Back to the step where what went wrong can be put right.
        switch error.code {
        case "apple_team_needed":
          go(.team)
          return
        case "apple_key_invalid":
          // A file that was no key after all is let go of, so that the place for it is empty again.
          key = ""
          fileName = ""
          step = .file
        case "apple_key_forbidden":
          step = .key
        case "apple_key_rejected":
          asksKeyID = true
          step = from
        default:
          step = from
        }
        errorText = Texts.apiError(error.code)
      }
    }
  }

  private func disconnect() {
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        status = try await api.disconnectApple()
        step = .have
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}

// MARK: - Small parts

/// How far through the counted steps the person is: one dot each, the ones reached filled in.
private struct StepDots: View {
  let count: Int
  let index: Int

  var body: some View {
    HStack(spacing: 8) {
      ForEach(0..<count, id: \.self) { dot in
        Capsule()
          .fill(dot <= index ? AnyShapeStyle(.brandGradient) : AnyShapeStyle(Color.secondary.opacity(0.25)))
          .frame(width: dot == index ? 28 : 10, height: 10)
      }
    }
    .animation(Motion.arrive, value: index)
    .accessibilityElement()
    .accessibilityLabel("Steg \(index + 1) av \(count)")
  }
}

/// Things to do in order, each with its number in a ring.
private struct Numbered: View {
  let lines: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          Text(verbatim: "\(index + 1)")
            .font(.footnote.weight(.heavy))
            .foregroundStyle(Color.brand)
            .frame(width: 24, height: 24)
            .background(Color.brand.opacity(0.14), in: .circle)
          Text(line)
            .font(.subheadline)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
      }
    }
  }
}

/// Apple's key page, drawn as simply as it can be: the three things to press light up in turn, with
/// the same numbers as the steps under the picture. The words on it are Apple's own, in English as
/// on the real page, so that they can be recognised there.
private struct KeyPicture: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Group {
      if reduceMotion {
        rows(beat: nil)
      } else {
        TimelineView(.periodic(from: .now, by: Self.beat)) { timeline in
          rows(beat: Int(timeline.date.timeIntervalSinceReferenceDate / Self.beat) % 3)
        }
      }
    }
    .accessibilityHidden(true)
  }

  private static let beat = 2.0

  private func rows(beat: Int?) -> some View {
    VStack(spacing: 6) {
      PictureRow(number: 1, isLit: beat.map { $0 == 0 }) {
        Text(verbatim: "Team Keys").foregroundStyle(.secondary)
        Spacer(minLength: 4)
        Press(isOn: beat == 0, shape: .circle) {
          Image(systemName: "plus")
            .font(.footnote.weight(.heavy))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(Color.brand, in: .circle)
        }
      }
      PictureRow(number: 2, isLit: beat.map { $0 == 1 }) {
        Text(verbatim: "Name").foregroundStyle(.secondary)
        Text(verbatim: "App Dance")
          .padding(.horizontal, 7)
          .padding(.vertical, 3)
          .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(.quaternary) }
        Spacer(minLength: 4)
        Press(isOn: beat == 1, shape: .rect(cornerRadius: 9)) {
          Text(verbatim: "Admin")
            .fontWeight(.bold)
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.brand, in: .rect(cornerRadius: 9))
        }
      }
      PictureRow(number: 3, isLit: beat.map { $0 == 2 }) {
        Text(verbatim: "App Dance").foregroundStyle(.secondary)
        Spacer(minLength: 4)
        Press(isOn: beat == 2, shape: .rect(cornerRadius: 9)) {
          Text(verbatim: "Download")
            .fontWeight(.bold)
            .foregroundStyle(Color.brand)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
        }
      }
    }
    .font(.footnote)
    .lineLimit(1)
    .padding(8)
    .background(Color(.paper), in: .rect(cornerRadius: 16, style: .continuous))
    .animation(Motion.swap, value: beat)
  }
}

/// Where the code is on Apple's page: above the keys, with Copy beside it.
private struct CodePicture: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 6) {
      PictureRow(number: nil, isLit: true) {
        Text(verbatim: "Issuer ID").foregroundStyle(.secondary)
        Text(verbatim: "69a6de7f-••••-••••")
          .font(.caption.monospaced())
          .padding(.horizontal, 7)
          .padding(.vertical, 3)
          .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(.quaternary) }
        Spacer(minLength: 4)
        Press(isOn: !reduceMotion, shape: .rect(cornerRadius: 9)) {
          Text(verbatim: "Copy")
            .fontWeight(.bold)
            .foregroundStyle(Color.brand)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
        }
      }
      PictureRow(number: nil, isLit: false) {
        Text(verbatim: "Team Keys").foregroundStyle(.secondary)
        Text(verbatim: "App Dance")
        Spacer(minLength: 4)
      }
    }
    .font(.footnote)
    .lineLimit(1)
    .padding(8)
    .background(Color(.paper), in: .rect(cornerRadius: 16, style: .continuous))
    .accessibilityHidden(true)
  }
}

/// One row of a picture of Apple's page. `isLit`: nil when nothing takes turns and every row is plain to see.
private struct PictureRow<Content: View>: View {
  let number: Int?
  let isLit: Bool?
  @ViewBuilder var content: Content

  var body: some View {
    HStack(spacing: 8) {
      if let number {
        Text(verbatim: "\(number)")
          .font(.caption.weight(.heavy))
          .foregroundStyle(Color.brand)
          .frame(width: 22, height: 22)
          .background(Color.brand.opacity(0.14), in: .circle)
      }
      content
    }
    .padding(.horizontal, 10)
    .frame(minHeight: 44)
    .background(Color(.card), in: .rect(cornerRadius: 11, style: .continuous))
    .opacity(isLit == false ? 0.45 : 1)
  }
}

/// Something to press in a picture. While it is its turn, a ring keeps spreading out from it, like
/// a finger landing on it.
private struct Press<Label: View, Outline: InsettableShape>: View {
  let isOn: Bool
  let shape: Outline
  @ViewBuilder var label: Label

  var body: some View {
    label.background {
      if isOn {
        shape
          .strokeBorder(Color.brand, lineWidth: 2)
          .padding(-4)
          .phaseAnimator([false, true]) { ring, spread in
            ring.scaleEffect(spread ? 1.18 : 1).opacity(spread ? 0 : 0.9)
          } animation: { spread in
            spread ? .easeOut(duration: 1.1) : nil
          }
          .transition(.opacity)
      }
    }
  }
}

#Preview {
  AppleAccountView(api: API(baseURL: API.configuredBaseURL))
}
