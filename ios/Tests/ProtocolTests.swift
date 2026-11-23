// The app is only as good as its reading of the server's messages: these pin that down.
import Foundation
import Testing
@testable import AppDance

private func event(_ json: String) throws -> ServerEvent {
  try JSONDecoder().decode(ServerEvent.self, from: Data(json.utf8))
}

private func summary() -> ProjectSummary {
  ProjectSummary(id: "abcdefgh1234", name: "Ny app", updatedAt: 0)
}

@MainActor
@Suite struct ProtocolTests {
  let store = ProjectStore(project: summary(), api: API(baseURL: URL(string: "http://localhost:1")!))

  @Test func `a full state replaces everything`() throws {
    store.apply(try event("""
      {"type":"state","project":{"id":"abcdefgh1234","name":"Vanor"},"running":true,
       "messages":[{"id":1,"role":"user","text":"En vanespårare","parts":[],"createdAt":1}],
       "parts":[{"t":"text","text":"Jag bygger"},{"t":"step","step":{"id":"s1","kind":"write","detail":"Sources/HabitView.swift","status":"running"}}],
       "preview":{"status":"building","stage":"compiling","mime":"image/jpeg","canInput":true},
       "publish":{"available":true,"account":"own","canConnect":true,"status":"idle"}}
      """))
    #expect(store.name == "Vanor")
    #expect(store.messages.map(\.text) == ["En vanespårare"])
    #expect(store.isRunning)
    #expect(store.liveParts.count == 2)
    #expect(store.preview.status == .building)
    #expect(store.publish.account == .own)
  }

  @Test func `a state from an older server has no publish part`() throws {
    store.apply(try event("""
      {"type":"state","project":{"id":"x","name":"App"},"running":false,"messages":[],"parts":[],
       "preview":{"status":"idle","mime":"image/jpeg","canInput":false}}
      """))
    #expect(store.publish == .none)
  }

  @Test func `text arrives in pieces and steps are replaced by their outcome`() throws {
    store.apply(.runStart)
    store.apply(try event(#"{"type":"text.delta","delta":"Jag "}"#))
    store.apply(try event(#"{"type":"text.delta","delta":"bygger."}"#))
    store.apply(try event(#"{"type":"step","step":{"id":"b1","kind":"build","detail":"","status":"running"}}"#))
    store.apply(try event(#"{"type":"step","step":{"id":"b1","kind":"build","detail":"","status":"done"}}"#))
    #expect(store.liveParts == [.text("Jag bygger."), .step(Step(id: "b1", kind: .build, detail: "", status: .done))])

    store.apply(try event(#"{"type":"message","message":{"id":7,"role":"assistant","text":"","parts":[{"t":"text","text":"Klart"}],"createdAt":2}}"#))
    store.apply(try event(#"{"type":"message","message":{"id":7,"role":"assistant","text":"","parts":[],"createdAt":2}}"#))
    store.apply(.runEnd)
    #expect(store.messages.count == 1, "the same message is not added twice")
    #expect(!store.isRunning && store.liveParts.isEmpty)
  }

  @Test func `values this version does not know do not break decoding`() throws {
    store.apply(try event(#"{"type":"something.new","payload":1}"#))
    store.apply(try event(#"{"type":"step","step":{"id":"n1","kind":"teleport","detail":"","status":"hovering"}}"#))
    store.apply(try event(#"{"type":"part","part":{"t":"hologram"}}"#))
    store.apply(try event(#"{"type":"preview","preview":{"status":"levitating","mime":"image/jpeg","canInput":false}}"#))
    #expect(store.liveParts.first == .step(Step(id: "n1", kind: .other, detail: "", status: .done)))
    #expect(store.preview.status == .idle)
  }

  @Test func `the upload waiting for the app says which bundle id to pick`() throws {
    store.apply(try event("""
      {"type":"publish","publish":{"available":true,"account":"own","canConnect":true,"status":"working",
       "stage":"waiting_for_app","bundleId":"app.appsmedjan.pabc","build":"202611191557","at":1}}
      """))
    let note = try #require(Texts.publishNote(store.publish))
    #expect(note.text.contains("app.appsmedjan.pabc") && !note.failed)
  }

  @Test func `the public test link arrives with the upload state`() throws {
    store.apply(try event("""
      {"type":"publish","publish":{"available":true,"account":"operator","canConnect":true,"status":"uploaded","build":"202611200902",
       "operator":false,"test":{"status":"approved","url":"https://testflight.apple.com/join/AbCd1234","build":"202611200902","at":1}}}
      """))
    #expect(store.publish.test?.status == .approved)
    #expect(store.publish.test?.url == "https://testflight.apple.com/join/AbCd1234")
    #expect(store.publish.operator == false)

    store.apply(try event(#"{"type":"publish","publish":{"available":true,"account":"operator","canConnect":true,"status":"uploaded","test":{"status":"needs_contact"}}}"#))
    #expect(store.publish.test?.status == .needsContact)
    // A status this version has never heard of is treated as "nothing yet", not as a broken message.
    store.apply(try event(#"{"type":"publish","publish":{"available":true,"account":"own","canConnect":true,"status":"uploaded","test":{"status":"teleporting"}}}"#))
    #expect(store.publish.test?.status == TestLink.Status.none)
  }

  @Test func `the App Store page is read as the server sends it`() throws {
    let json = """
      {"listing":{"name":"Borstkoll","subtitle":"","promo":"","description":"En timer.","keywords":"timer","supportUrl":"https://x.example/s",
        "marketingUrl":"","privacyUrl":"https://x.example/p","category":"HEALTH_AND_FITNESS"},
       "screenshots":["a1","b2"],"hasIcon":false,"canCapture":true,"available":true,"account":"operator","problems":["subtitle_long"],
       "build":"202611200729","choices":{"noMatureContent":true,"noThirdPartyContent":false,"free":true},
       "pages":{"hosted":true,"supportEmail":"hjalp@x.example","privacyText":"Allt sparas på telefonen.","lang":"sv"},
       "contact":{"firstName":"Hugo","lastName":"Jansson","phone":"+46 70 123 45 67","email":"hugo@x.example","holder":""},
       "canSubmit":false,"submit":{"status":"failed","error":"rejected","detail":"You must declare whether your app is a regulated medical device."},
       "sync":{"status":"done","attached":"attached","at":1}}
      """
    let state = try JSONDecoder().decode(StoreState.self, from: Data(json.utf8))
    #expect(state.screenshots == ["a1", "b2"] && state.choices.noMatureContent && state.pages.hosted)
    #expect(state.sync.status == .done && state.sync.attached == "attached")
    #expect(state.contact.problem == nil)
    #expect(Texts.refusalHints(state.submit.detail ?? "").count == 1)
    #expect(Texts.listingProblem("subtitle_long") != "subtitle_long")
  }

  @Test(arguments: [
    (ReviewContact(firstName: "", lastName: "Jansson", phone: "+46 70 123 45 67", email: "a@b.se"), ReviewContact.Problem.name),
    (ReviewContact(firstName: "Hugo", lastName: "Jansson", phone: "070 123 45 67", email: "a@b.se"), .phone),
    (ReviewContact(firstName: "Hugo", lastName: "Jansson", phone: "+46 70 123 45 67", email: "a(at)b.se"), .email),
  ])
  func `contact details say what is wrong with them`(contact: ReviewContact, problem: ReviewContact.Problem) {
    #expect(contact.problem == problem)
  }

  @Test(arguments: [
    (InputEvent.tap(x: 0.5, y: 0.25), #"{"kind":"tap","x":0.5,"y":0.25}"#),
    (InputEvent.text("hej"), #"{"kind":"text","text":"hej"}"#),
    (InputEvent.key(.backspace), #"{"key":"backspace","kind":"key"}"#),
    (InputEvent.home, #"{"button":"home","kind":"button"}"#),
    (InputEvent.swipe(x1: 0, y1: 1, x2: 0.5, y2: 0.5, durationMs: 300), #"{"durationMs":300,"kind":"swipe","x1":0,"x2":0.5,"y1":1,"y2":0.5}"#),
  ])
  func `input is sent in the shape the server expects`(input: InputEvent, json: String) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    #expect(String(decoding: try encoder.encode(input), as: UTF8.self) == json)
  }

  // The dance must start and end every phrase in the icon's pose, or one move would jump into the next.
  @Test(arguments: [0.0, 1, 2, 3, 4, 5, 6, 11])
  func `every phrase of the dance starts in the pose of the icon`(phrase: Double) {
    let pose = MascotPose(time: phrase * MascotPose.phrase)
    #expect(abs(pose.swing) < 0.001)
    #expect(abs(pose.lift) < 0.001)
    #expect(abs(pose.turn - 1) < 0.001)
    #expect(abs(pose.slide) < 0.001)
    #expect(abs(pose.wave) < 0.001)
    #expect(abs(pose.stretch - 1) < 0.001)
    #expect(abs(pose.gaze) < 0.001)
  }

  @Test func `the dance stays inside what the mascot can do`() {
    for step in 0..<2000 {
      let pose = MascotPose(time: Double(step) * 0.0137)
      #expect((0...1).contains(pose.swing))
      #expect((0...2.2).contains(pose.lift))
      #expect((-1...1).contains(pose.turn))
      #expect((-3...3).contains(pose.slide))
      #expect((0.9...1.1).contains(pose.stretch))
      #expect((-0.7...0.7).contains(pose.gaze))
    }
  }

  @Test func `the clues follow the builder's latest step`() {
    var number = 0
    func step(_ kind: Step.Kind, _ status: Step.Status = .done) -> Part {
      number += 1
      return .step(Step(id: "s\(number)", kind: kind, detail: "", status: status))
    }
    #expect(RunProgress(parts: []).phase == .thinking)
    #expect(RunProgress(parts: [step(.rename), step(.icon, .running)]).phase == .drawing)
    #expect(RunProgress(parts: [step(.write), step(.write), step(.write, .running)]).pieces == 2)
    #expect(RunProgress(parts: [step(.write), step(.build, .running)]).phase == .trying)
    #expect(RunProgress(parts: [step(.write), step(.build, .error), step(.edit, .running)]).phase == .fixing)
    #expect(RunProgress(parts: [step(.write), step(.build, .error), step(.edit), step(.build), step(.edit, .running)]).phase == .making)
    #expect(RunProgress(parts: [step(.write), step(.build), step(.look, .running)]).phase == .looking)
    let run = [step(.write), step(.write), step(.icon), step(.build, .error), step(.edit), step(.build), step(.look)]
    let way = run.indices.map { RunProgress(parts: Array(run[...$0])).fraction }
    #expect(zip(way, way.dropFirst()).allSatisfy { $0 <= $1 })
    #expect(way.last! <= 0.92)
  }

  @Test(arguments: [
    ("Nu är din växtapp grön. Tryck på plus för att lägga till en växt.", "Nu är din växtapp grön."),
    ("  Klart!\n\nTesta så här:\n- Tryck på ringen", "Klart!"),
    ("Version 2.0 är klar. Mer text.", "Version 2.0 är klar."),
    ("Utan punkt", "Utan punkt"),
    ("", ""),
  ])
  func `the install question carries only the first sentence`(text: String, sentence: String) {
    #expect(text.firstSentence() == sentence)
  }

  @Test func `a frame of the stream is known for what it is`() {
    let code: [UInt8] = [0, 0, 0, 1]
    let settings = Data(code + [0x67, 0x64, 0x00, 0x33]), more = Data(code + [0x68, 1]), whole = Data(code + [0x65, 0x88, 1, 2])
    let change = Data(code + [0x41, 0x9a, 7])
    #expect(StreamFrame.kind(of: settings + more + whole) == .key)
    #expect(StreamFrame.kind(of: change) == .delta)
    #expect(StreamFrame.kind(of: Data([0xff, 0xd8, 0xff, 0xe0, 0, 16])) == .still)
    #expect(StreamFrame.kind(of: Data()) == .still)
    #expect(StreamFrame.units(in: settings + more + whole).map { Array($0) } == [[0x67, 0x64, 0x00, 0x33], [0x68, 1], [0x65, 0x88, 1, 2]])
    // A picture cut out of a longer run of bytes does not start at index zero.
    let cut = (Data([9, 9]) + change).dropFirst(2)
    #expect(StreamFrame.units(in: cut).map { Array($0) } == [[0x41, 0x9a, 7]])
  }

  @Test func `a finger on its way is sent with where it is and what it is doing`() throws {
    struct Sent: Decodable, Equatable { let kind: String; let phase: String; let x: Double; let y: Double }
    let data = try JSONEncoder().encode(InputEvent.touch(.move, x: 0.25, y: 0.75))
    #expect(try JSONDecoder().decode(Sent.self, from: data) == Sent(kind: "touch", phase: "move", x: 0.25, y: 0.75))
  }

  @Test func `a moving finger is sent where it is heading, no more often than the simulator draws`() {
    let screen = CGSize(width: 400, height: 800)
    var track = FingerTrack(landingAt: CGPoint(x: 200, y: 600), time: 10, on: screen)
    #expect(track.landing == .touch(.down, x: 0.5, y: 0.75))
    // Seen 120 times a second: every second report is sent, and it is the place ahead that goes.
    #expect(track.move(to: CGPoint(x: 200, y: 592), heading: CGPoint(x: 200, y: 576), time: 10.0083) == nil)
    #expect(track.move(to: CGPoint(x: 200, y: 584), heading: CGPoint(x: 200, y: 568), time: 10.0166) == .touch(.move, x: 0.5, y: 0.71))
    #expect(track.move(to: CGPoint(x: 200, y: 576), heading: CGPoint(x: 200, y: 560), time: 10.025) == nil)
    #expect(track.move(to: CGPoint(x: 200, y: 568), heading: CGPoint(x: 200, y: 552), time: 10.0333) == .touch(.move, x: 0.5, y: 0.69))
    // Let go of while still moving: it lifts where the simulator's finger already is, not a step back.
    #expect(track.lift(at: CGPoint(x: 200, y: 560), time: 10.0416) == .touch(.up, x: 0.5, y: 0.69))
    // Let go of after it has come to rest: it lifts exactly where it is.
    #expect(track.lift(at: CGPoint(x: 200, y: 568), time: 10.4) == .touch(.up, x: 0.5, y: 0.71))
    #expect(track.letGo == .touch(.up, x: 0.5, y: 0.69))
  }

  @Test func `a finger that is not looked ahead for is sent where it is`() {
    var track = FingerTrack(landingAt: CGPoint(x: 100, y: 100), time: 0, on: CGSize(width: 400, height: 800))
    #expect(track.move(to: CGPoint(x: 100, y: 140), heading: nil, time: 0.02) == .touch(.move, x: 0.25, y: 0.175))
    #expect(track.lift(at: CGPoint(x: 100, y: 180), time: 0.03) == .touch(.up, x: 0.25, y: 0.225))
    // A place outside the screen, as a finger heading off its edge is reckoned to reach, stays on it.
    #expect(track.move(to: CGPoint(x: 100, y: 790), heading: CGPoint(x: 100, y: 830), time: 0.06) == .touch(.move, x: 0.25, y: 1))
  }

  @Test func `the server can have the finger sent where it is`() throws {
    let plain = try JSONDecoder().decode(PreviewState.self, from: Data(#"{"status":"running","mime":"video/h264","canInput":true}"#.utf8))
    #expect(plain.predictFinger == nil)
    let off = try JSONDecoder().decode(PreviewState.self, from: Data(#"{"status":"running","mime":"video/h264","canInput":true,"predictFinger":false}"#.utf8))
    #expect(off.predictFinger == false)
  }

  @Test func `what the builder says is shown and is not counted as work`() throws {
    func said(_ text: String) -> Part {
      .step(Step(id: UUID().uuidString, kind: .say, detail: text, status: .done))
    }
    let write = Part.step(Step(id: "w", kind: .write, detail: "", status: .done))
    let trying = Part.step(Step(id: "b", kind: .build, detail: "", status: .running))
    #expect([Part]().said.isEmpty)
    #expect([said("Väljer färger"), write, said(" Nu gör jag listan "), said("")].said == ["Väljer färger", "Nu gör jag listan"])
    #expect(RunProgress(parts: [write, trying, said("Provar")]).phase == .trying)
    #expect(RunProgress(parts: [said("Hej")]) == RunProgress(parts: []))
    // A step of the kind arrives from the server as any other step does.
    let part = try JSONDecoder().decode(Part.self, from: Data(#"{"t":"step","step":{"id":"s","kind":"say","detail":"Ritar ikonen","status":"done"}}"#.utf8))
    #expect([part].said == ["Ritar ikonen"])
  }

  @Test func `a first sentence that runs on is cut at a word`() {
    let long = ("Appen har " + String(repeating: "många kaféer i sju stadsdelar, ", count: 8) + "och mer.").firstSentence()
    #expect(long.count <= 141)
    #expect(long.hasSuffix("…"))
    #expect(!long.hasSuffix(" …") && !long.hasSuffix(",…"))
  }
}
