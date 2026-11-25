// Who is logged in. One instance for the whole app.
import Foundation
import Observation

@Observable
final class AppModel {
  enum Phase: Equatable {
    case starting
    case signedOut
    case signedIn(User)
  }

  private(set) var phase = Phase.starting
  let api = API(baseURL: API.configuredBaseURL)

  /// Finds out whether the stored login is still good.
  func start() async {
    guard phase == .starting else { return }
    #if DEBUG
    adoptSessionFromLaunchArguments()
    #endif
    do {
      phase = if let user = try await api.currentUser() { .signedIn(user) } else { .signedOut }
    } catch {
      // Without the server nothing can be shown; the login screen says what is wrong on the next try.
      phase = .signedOut
    }
  }

  #if DEBUG
  /// Lets a development build start signed in, for trying the app out without typing a password in
  /// the simulator: launch it with `-sessionCookie <value of the server's "sid" cookie>`.
  private func adoptSessionFromLaunchArguments() {
    guard let value = UserDefaults.standard.string(forKey: "sessionCookie"), let host = api.baseURL.host() else { return }
    let cookie = HTTPCookie(properties: [.name: "sid", .value: value, .domain: host, .path: "/"])
    if let cookie { HTTPCookieStorage.shared.setCookie(cookie) }
  }
  #endif

  func logIn(email: String, password: String) async throws(APIError) {
    phase = .signedIn(try await api.logIn(email: email, password: password))
  }

  func signUp(email: String, password: String, inviteCode: String) async throws(APIError) {
    phase = .signedIn(try await api.signUp(email: email, password: password, inviteCode: inviteCode))
  }

  /// Deletes the account, and this phone forgets the login.
  func deleteAccount(password: String) async throws(APIError) {
    try await api.deleteAccount(password: password)
    HTTPCookieStorage.shared.cookies(for: api.baseURL)?.forEach(HTTPCookieStorage.shared.deleteCookie)
    phase = .signedOut
  }

  func logOut() async {
    // This phone stops getting the person's notifications.
    if let token = Notifications.token { try? await api.forgetPushToken(token) }
    // Even if the server cannot be told, this phone forgets the login.
    try? await api.logOut()
    HTTPCookieStorage.shared.cookies(for: api.baseURL)?.forEach(HTTPCookieStorage.shared.deleteCookie)
    phase = .signedOut
  }
}
