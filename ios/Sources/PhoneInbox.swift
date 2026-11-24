// Apps sent to this phone from the web. While App Dance is open and signed in it keeps a line to the
// server, and an app sent from the web comes in on it: iOS's question whether to install shows at once.
// When App Dance is not open, the same thing arrives as a notification, and tapping it does the same.
// iOS never installs without the phone's owner saying yes, so that one tap is always theirs.
import OSLog
import SwiftUI
import UIKit
import UserNotifications

private let log = Logger(subsystem: "app.appsmedjan.ios", category: "inbox")

/// Hands an app sent to this phone over to iOS, which asks whether to install it.
@MainActor
enum Installer {
  static func install(pagePath: String) {
    guard let url = API(baseURL: API.configuredBaseURL).installURL(forPagePath: pagePath) else { return }
    UIApplication.shared.open(url)
  }
}

/// The line to the server while the app is open. Runs until the surrounding task is cancelled.
struct PhoneInbox {
  let api: API

  private struct Sent: Decodable {
    let type: String
    let path: String?
  }

  func run() async {
    var delay = Duration.seconds(1)
    while !Task.isCancelled {
      let task = URLSession.shared.webSocketTask(with: api.inboxRequest())
      task.resume()
      do {
        while true {
          if case .string(let text) = try await task.receive() {
            delay = .seconds(1)
            if let sent = try? JSONDecoder().decode(Sent.self, from: Data(text.utf8)), sent.type == "install", let path = sent.path {
              Installer.install(pagePath: path)
            }
          }
        }
      } catch {
        log.debug("inbox closed: \(error.localizedDescription, privacy: .public)")
      }
      task.cancel(with: .goingAway, reason: nil)
      try? await Task.sleep(for: delay)
      delay = min(delay * 2, .seconds(30))
    }
  }
}

/// Notifications: asked for when the person first wants an app on this phone, and their address
/// handed to the server, which uses it when App Dance is not open.
@MainActor
enum Notifications {
  /// This phone's address for notifications, once iOS has given it.
  private(set) static var token: String?

  /// Asks once whether App Dance may send notifications; later calls only renew the address.
  static func ask() {
    Task {
      let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
      if granted { UIApplication.shared.registerForRemoteNotifications() }
    }
  }

  /// At launch: renews the address if the person has already said yes.
  static func renew() {
    Task {
      let settings = await UNUserNotificationCenter.current().notificationSettings()
      if settings.authorizationStatus == .authorized { UIApplication.shared.registerForRemoteNotifications() }
    }
  }

  static func received(_ deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    token = hex
    Task { try? await API(baseURL: API.configuredBaseURL).savePushToken(hex) }
  }
}

/// iOS's hooks for notifications: the address, and a tap on one.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    Notifications.renew()
    return true
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    Notifications.received(deviceToken)
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
    log.debug("no notification address: \(error.localizedDescription, privacy: .public)")
  }

  /// The person tapped "the app is ready": straight to iOS's question whether to install it.
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    let path = response.notification.request.content.userInfo["path"] as? String
    guard let path else { return }
    await MainActor.run { Installer.install(pagePath: path) }
  }

  /// While App Dance is open the line to the server has already done it; the notification still shows, quietly.
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
    [.banner]
  }
}
