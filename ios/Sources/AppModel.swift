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
    do {
      phase = if let user = try await api.currentUser() { .signedIn(user) } else { .signedOut }
    } catch {
      // Without the server nothing can be shown; the login screen says what is wrong on the next try.
      phase = .signedOut
    }
  }

  func logIn(email: String, password: String) async throws(APIError) {
    phase = .signedIn(try await api.logIn(email: email, password: password))
  }

  func signUp(email: String, password: String, inviteCode: String) async throws(APIError) {
    phase = .signedIn(try await api.signUp(email: email, password: password, inviteCode: inviteCode))
  }

  func logOut() async {
    // Even if the server cannot be told, this phone forgets the login.
    try? await api.logOut()
    HTTPCookieStorage.shared.cookies(for: api.baseURL)?.forEach(HTTPCookieStorage.shared.deleteCookie)
    phase = .signedOut
  }
}
