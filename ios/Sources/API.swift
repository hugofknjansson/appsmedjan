// Talks to the Appsmedjan server's REST API. The session cookie the server sets at login is kept by
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

  private func request<Response: Decodable>(_ method: String, _ path: String, body: Data?) async throws(APIError) -> Response {
    var request = URLRequest(url: baseURL.appending(path: path))
    request.httpMethod = method
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "content-type")
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
  func socketRequest(projectID: String) -> URLRequest {
    var parts = URLComponents(url: baseURL.appending(path: "ws"), resolvingAgainstBaseURL: false)!
    parts.scheme = baseURL.scheme == "http" ? "ws" : "wss"
    parts.queryItems = [URLQueryItem(name: "project", value: projectID)]
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
  private struct Config: Decodable { let inviteRequired: Bool }
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

  func inviteRequired() async throws(APIError) -> Bool {
    let config: Config = try await get("api/config")
    return config.inviteRequired
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
}
