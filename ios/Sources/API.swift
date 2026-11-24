// Talks to the App Dance server's REST API. The session cookie the server sets at login is kept by
// URLSession's cookie storage, so being logged in survives restarts of the app.
import Foundation

/// A failed request. `code` is the server's own error code ("wrong_login", "daily_limit"), or
/// "network" when the server could not be reached at all.
struct APIError: Error, Equatable {
  let code: String

  static let network = APIError(code: "network")
  static let unexpected = APIError(code: "internal")
}

struct API {
  /// Where the server lives. A development build can point elsewhere with the launch argument
  /// `-serverURL http://localhost:8787`, which UserDefaults picks up by itself.
  static var configuredBaseURL: URL {
    let fallback = URL(string: "https://appsmedjan.fly.dev")!
    guard let text = UserDefaults.standard.string(forKey: "serverURL"), let url = URL(string: text), url.host != nil else {
      return fallback
    }
    return url
  }

  let baseURL: URL

  private struct Empty: Codable {}
  private struct Failure: Decodable { let error: String }

  func get<Response: Decodable>(_ path: String) async throws(APIError) -> Response {
    try await request("GET", path, body: nil)
  }

  func send<Response: Decodable>(_ method: String, _ path: String, body: some Encodable) async throws(APIError) -> Response {
    guard let data = try? JSONEncoder().encode(body) else { throw .unexpected }
    return try await request(method, path, body: data)
  }

  /// For requests whose answer carries nothing worth reading.
  func send(_ method: String, _ path: String) async throws(APIError) {
    let _: Empty = try await request(method, path, body: Data("{}".utf8))
  }

  private func request<Response: Decodable>(
    _ method: String,
    _ path: String,
    body: Data?,
    contentType: String = "application/json"
  ) async throws(APIError) -> Response {
    var request = URLRequest(url: baseURL.appending(path: path))
    request.httpMethod = method
    if let body {
      request.httpBody = body
      request.setValue(contentType, forHTTPHeaderField: "content-type")
    }

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw .network
    }
    guard let http = response as? HTTPURLResponse else { throw .unexpected }
    guard (200..<300).contains(http.statusCode) else {
      throw APIError(code: (try? JSONDecoder().decode(Failure.self, from: data))?.error ?? "internal")
    }
    guard let value = try? JSONDecoder().decode(Response.self, from: data) else { throw .unexpected }
    return value
  }

  /// The request that opens a project's WebSocket.
  /// The phone's model as Apple names its hardware, "iPhone19,2"; in the simulator, the model it stands in for.
  static let phoneModel: String = {
    if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
    var system = utsname()
    uname(&system)
    return withUnsafeBytes(of: &system.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
  }()

  /// `takesVideo`: the screen may be sent as video and not only as still pictures.
  func socketRequest(projectID: String, takesVideo: Bool) -> URLRequest {
    var parts = URLComponents(url: baseURL.appending(path: "ws"), resolvingAgainstBaseURL: false)!
    parts.scheme = baseURL.scheme == "http" ? "ws" : "wss"
    parts.queryItems = [URLQueryItem(name: "project", value: projectID)]
    if takesVideo { parts.queryItems?.append(URLQueryItem(name: "video", value: "h264")) }
    // Which model of phone this is, so that the app can be tried in a simulator of the same one.
    parts.queryItems?.append(URLQueryItem(name: "device", value: Self.phoneModel))
    var request = URLRequest(url: parts.url!)
    // The login cookie is stored for the http(s) address; hand it to the socket explicitly.
    let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) ?? []
    for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) {
      request.setValue(value, forHTTPHeaderField: field)
    }
    return request
  }
}

// MARK: - Endpoints

extension API {
  private struct Me: Decodable { let user: User? }
  private struct Signed: Decodable { let user: User }
  private struct Config: Decodable {
    let inviteRequired: Bool
    /// Missing from servers before the paywall.
    var paywall: Bool?
  }
  private struct Projects: Decodable { let projects: [ProjectSummary] }
  private struct Created: Decodable { let project: ProjectSummary }
  private struct Credentials: Encodable {
    let email: String
    let password: String
    var inviteCode: String?
  }
  private struct Prompt: Encodable {
    let text: String
    var name: String?
  }

  struct Status: Decodable {
    let workers: Int
    let agentReady: Bool
  }

  func currentUser() async throws(APIError) -> User? {
    let me: Me = try await get("api/me")
    return me.user
  }

  /// What a visitor needs to know before signing in: whether an invite is asked for, and whether
  /// building costs something.
  func welcome() async throws(APIError) -> (inviteRequired: Bool, paywall: Bool) {
    let config: Config = try await get("api/config")
    return (config.inviteRequired, config.paywall ?? false)
  }

  func logIn(email: String, password: String) async throws(APIError) -> User {
    let signed: Signed = try await send("POST", "api/auth/login", body: Credentials(email: email, password: password))
    return signed.user
  }

  func signUp(email: String, password: String, inviteCode: String) async throws(APIError) -> User {
    let body = Credentials(email: email, password: password, inviteCode: inviteCode)
    let signed: Signed = try await send("POST", "api/auth/signup", body: body)
    return signed.user
  }

  func logOut() async throws(APIError) {
    try await send("POST", "api/auth/logout")
  }

  func status() async throws(APIError) -> Status {
    try await get("api/status")
  }

  func projects() async throws(APIError) -> [ProjectSummary] {
    let list: Projects = try await get("api/projects")
    return list.projects
  }

  /// Creates an app from a description and starts the agent on it straight away.
  func createProject(prompt: String, name: String) async throws(APIError) -> ProjectSummary {
    let created: Created = try await send("POST", "api/projects", body: Prompt(text: prompt, name: name))
    return created.project
  }

  func deleteProject(_ id: String) async throws(APIError) {
    try await send("DELETE", "api/projects/\(id)")
  }

  func sendMessage(_ text: String, to id: String) async throws(APIError) {
    let _: Empty = try await send("POST", "api/projects/\(id)/messages", body: Prompt(text: text))
  }

  func stopRun(_ id: String) async throws(APIError) {
    try await send("POST", "api/projects/\(id)/stop")
  }

  func sendToTestFlight(_ id: String) async throws(APIError) {
    try await send("POST", "api/projects/\(id)/testflight")
  }

  func plan() async throws(APIError) -> PlanState {
    try await get("api/plan")
  }

  /// A code in place of paying: lets the person past the paywall, with the plan the code gives.
  func unlockPlan(code: String) async throws(APIError) -> PlanState {
    struct Body: Encodable { let code: String }
    return try await send("POST", "api/plan/unlock", body: Body(code: code))
  }

  /// Asks for a larger plan. There is no payment yet: the people who run the service answer.
  func requestPlan(_ id: String) async throws(APIError) -> PlanState {
    struct Body: Encodable { let plan: String }
    return try await send("POST", "api/plan/request", body: Body(plan: id))
  }

  /// A page for adding this phone, to open in Safari: the profile that hands over the phone's
  /// identifier can only be fetched there. The link lets a phone in without a sign-in, for half an hour.
  /// `projectId`: the app it is added from. Once added, the phone goes straight on to installing it,
  /// from the page Safari lands on, without coming back here first.
  func addPhoneURL(from projectId: String) async throws(APIError) -> URL {
    struct Body: Encodable { let projectId: String }
    struct Ticket: Decodable { let path: String }
    let ticket: Ticket = try await send("POST", "api/phones/ticket", body: Body(projectId: projectId))
    return baseURL.appending(path: ticket.path)
  }

  /// Builds the app for the person's own phones. The outcome arrives with the publish state.
  func buildForPhone(_ id: String) async throws(APIError) {
    try await send("POST", "api/projects/\(id)/direct")
  }

  /// What makes iOS install a finished build: a link to the list of what to install.
  func installURL(forPagePath path: String) -> URL? {
    guard let token = path.split(separator: "/").last else { return nil }
    let manifest = baseURL.appending(path: "d/app/\(token)/manifest.plist").absoluteString
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    guard let encoded = manifest.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
    return URL(string: "itms-services://?action=download-manifest&url=\(encoded)")
  }

  func url(forPath path: String) -> URL {
    baseURL.appending(path: path)
  }

  /// Prepares the public TestFlight link again, with contact details when those were what was missing.
  func shareAgain(_ id: String, contact: ReviewContact? = nil) async throws(APIError) {
    struct Body: Encodable { let contact: ReviewContact? }
    let _: Empty = try await send("POST", "api/projects/\(id)/testlink", body: Body(contact: contact))
  }

  /// Asks to be invited to the operator's team as an internal tester of this app.
  func fastTrack(_ id: String, person: TesterPerson) async throws(APIError) {
    let _: Empty = try await send("POST", "api/projects/\(id)/fasttrack", body: person)
  }

  func operatorRequests() async throws(APIError) -> [AppRequest] {
    struct Requests: Decodable { let requests: [AppRequest] }
    let answer: Requests = try await get("api/operator/requests")
    return answer.requests
  }
}

// MARK: - App Store page

extension API {
  func store(_ id: String) async throws(APIError) -> StoreState {
    try await get("api/projects/\(id)/store")
  }

  func saveStore(_ id: String, listing: StoreListing, choices: StoreChoices, contact: ReviewContact, pages: StorePages) async throws(APIError) -> StoreState {
    struct Page: Encodable {
      let listing: StoreListing
      let choices: StoreChoices
      let contact: ReviewContact
      let pages: StorePages
    }
    return try await send("PUT", "api/projects/\(id)/store/listing", body: Page(listing: listing, choices: choices, contact: contact, pages: pages))
  }

  func draftStore(_ id: String) async throws(APIError) -> StoreDraft {
    try await request("POST", "api/projects/\(id)/store/draft", body: Data("{}".utf8))
  }

  func captureScreenshot(_ id: String) async throws(APIError) -> StoreState {
    try await request("POST", "api/projects/\(id)/store/screenshots", body: Data("{}".utf8))
  }

  func deleteScreenshot(_ id: String, shot: String) async throws(APIError) -> StoreState {
    try await request("DELETE", "api/projects/\(id)/store/screenshots/\(shot)", body: nil)
  }

  func screenshotURL(_ id: String, shot: String) -> URL {
    baseURL.appending(path: "api/projects/\(id)/store/screenshots/\(shot)")
  }

  /// The app's icon as the list shows it: nil while the app has none. The time makes a changed icon load again.
  func iconURL(_ id: String, changedAt: Double?) -> URL? {
    guard let changedAt else { return nil }
    // A small version: the full icon can be a couple of megabytes.
    return iconURL(id).appending(queryItems: [URLQueryItem(name: "size", value: "138"), URLQueryItem(name: "v", value: String(Int(changedAt)))])
  }

  func iconURL(_ id: String) -> URL {
    baseURL.appending(path: "api/projects/\(id)/store/icon")
  }

  /// The icon as a 1024 px PNG.
  func uploadIcon(_ id: String, png: Data) async throws(APIError) -> StoreState {
    try await request("PUT", "api/projects/\(id)/store/icon", body: png, contentType: "image/png")
  }

  func deleteIcon(_ id: String) async throws(APIError) -> StoreState {
    try await request("DELETE", "api/projects/\(id)/store/icon", body: nil)
  }

  func syncStore(_ id: String) async throws(APIError) -> StoreState {
    try await request("POST", "api/projects/\(id)/store/sync", body: Data("{}".utf8))
  }

  func submitStore(_ id: String) async throws(APIError) -> StoreState {
    try await request("POST", "api/projects/\(id)/store/submit", body: Data("{}".utf8))
  }
}

// MARK: - The person's own Apple developer account

extension API {
  func appleAccount() async throws(APIError) -> AppleStatus {
    try await get("api/apple-account")
  }

  func connectApple(key: String, keyID: String, issuerID: String, teamID: String) async throws(APIError) -> AppleStatus {
    struct Body: Encodable {
      let key: String
      let keyId: String
      let issuerId: String
      let teamId: String
    }
    return try await send("PUT", "api/apple-account", body: Body(key: key, keyId: keyID, issuerId: issuerID, teamId: teamID))
  }

  func disconnectApple() async throws(APIError) -> AppleStatus {
    try await request("DELETE", "api/apple-account", body: nil)
  }
}
