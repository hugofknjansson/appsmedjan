import SwiftUI

@main
struct AppDanceApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .tint(.brand)
    }
  }
}

extension Color {
  /// The brand orange, as on the web.
  static let brand = Color(red: 0.85, green: 0.31, blue: 0.04)
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
