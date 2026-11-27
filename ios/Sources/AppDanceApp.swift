import SwiftUI

@main
struct AppDanceApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @State private var model = AppModel()

  init() {
    // Navigation titles are drawn by UIKit, which does not follow SwiftUI's font design.
    let bar = UINavigationBar.appearance()
    bar.largeTitleTextAttributes = [.font: Self.rounded(.largeTitle, weight: .heavy)]
    bar.titleTextAttributes = [.font: Self.rounded(.headline, weight: .bold)]
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .tint(.brand)
        .fontDesign(.rounded)
    }
  }

  /// The system's rounded face at the size of a text style, following the person's text size.
  private static func rounded(_ style: UIFont.TextStyle, weight: UIFont.Weight) -> UIFont {
    let size = UIFontDescriptor.preferredFontDescriptor(withTextStyle: style).pointSize
    let plain = UIFont.systemFont(ofSize: size, weight: weight)
    return plain.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: size) } ?? plain
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    switch model.phase {
    case .starting:
      // Continues from the launch screen's orange, with the mascot warming up.
      ZStack {
        Rectangle().fill(.brandGradient).ignoresSafeArea()
        Mascot(tile: .white, eyes: .brandDeep, isDancing: true)
          .frame(width: 150)
      }
      .task { await model.start() }
    case .signedOut:
      AuthView()
    case .signedIn(let user):
      DashboardView(user: user)
        // Said once when the person is shown more than before, over whatever screen they are on.
        .overlay(alignment: .bottom) { LevelNote(api: model.api) }
        .animation(Motion.arrive, value: Depth.shared.state)
        // While the app is open, apps sent to this phone from the web come in on a line of its own.
        .task(id: scenePhase == .active) {
          guard scenePhase == .active else { return }
          await PhoneInbox(api: model.api).run()
        }
    }
  }
}
