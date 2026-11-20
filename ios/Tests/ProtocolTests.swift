// The app is only as good as its reading of the server's messages: these pin that down.
import Foundation
import Testing
@testable import Appsmedjan

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

  @Test(arguments: [
    ("Sources/Views/HabitListView.swift", "Habit List View"),
    ("Sources/App.swift", "App"),
    ("Sources/Models/todo_item.swift", "todo item"),
  ])
  func `file paths are shown as plain names`(path: String, name: String) {
    #expect(Texts.friendlyName(path) == name)
  }
}
