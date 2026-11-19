import SwiftUI

@main
struct AppsmedjanApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .tint(.forge)
    }
  }
}

extension Color {
  /// The orange of the forge, as on the web.
  static let forge = Color(red: 0.85, green: 0.31, blue: 0.04)
}

struct RootView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    switch model.phase {
    case .starting:
      ProgressView()
        .task { await model.start() }
    case .signedOut:
      AuthView()
    case .signedIn(let user):
      DashboardView(user: user)
    }
  }
}
