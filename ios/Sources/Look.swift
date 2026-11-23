// The look of the app: the colours of the icon, round shapes, and controls that give a little when pressed.
import SwiftUI

extension Color {
  /// The brand orange, as on the web.
  static let brand = Color(red: 0.85, green: 0.31, blue: 0.04)
  /// The two ends of the icon's background.
  static let brandLight = Color(red: 0.96, green: 0.48, blue: 0.14)
  static let brandDeep = Color(red: 0.78, green: 0.25, blue: 0.02)
}

extension ShapeStyle where Self == LinearGradient {
  /// The icon's background: light orange at the top left, deep orange at the bottom right.
  static var brandGradient: LinearGradient {
    LinearGradient(colors: [.brandLight, .brandDeep], startPoint: .topLeading, endPoint: .bottomTrailing)
  }
}

// MARK: - Motion

/// How things move, the same everywhere: quick where the person acts, a little softer where the app answers.
enum Motion {
  /// A press: answers at once and gives only a little, so that it feels heard without feeling slow.
  static let press = Animation.spring(duration: 0.2, bounce: 0.25)
  /// Something that arrives or leaves: lands without overshooting more than a hair.
  static let arrive = Animation.spring(duration: 0.45, bounce: 0.12)
  /// One thing turning into another in place.
  static let swap = Animation.smooth(duration: 0.35)

  /// What arrives with the person's choice of less motion: the same, without the movement.
  static func arrive(reduced: Bool) -> Animation { reduced ? .easeOut(duration: 0.2) : arrive }
}

extension AnyTransition {
  /// Comes up from a little below and out of a blur; leaves by fading, quicker than it came.
  static var rise: AnyTransition {
    .asymmetric(
      insertion: .modifier(active: Rising(isAway: true), identity: Rising(isAway: false)),
      removal: .opacity.animation(.easeOut(duration: 0.15))
    )
  }
}

private struct Rising: ViewModifier {
  let isAway: Bool
  func body(content: Content) -> some View {
    content
      .opacity(isAway ? 0 : 1)
      .offset(y: isAway ? 12 : 0)
      .scaleEffect(isAway ? 0.97 : 1, anchor: .bottom)
      .blur(radius: isAway ? 4 : 0)
  }
}

// MARK: - Zoom

extension View {
  /// Where a screen that opens from here grows out of, on iOS versions that can do it.
  @ViewBuilder func zoomSource(_ id: some Hashable, in namespace: Namespace.ID, cornerRadius: CGFloat = 0) -> some View {
    if #available(iOS 18, *) {
      matchedTransitionSource(id: id, in: namespace) { $0.clipShape(.rect(cornerRadius: cornerRadius, style: .continuous)) }
    } else {
      self
    }
  }

  /// Opens this screen out of the place marked with the same id, and closes it back into it.
  @ViewBuilder func zoomDestination(_ id: some Hashable, in namespace: Namespace.ID) -> some View {
    if #available(iOS 18, *) {
      navigationTransition(.zoom(sourceID: id, in: namespace))
    } else {
      self
    }
  }
}

// MARK: - Buttons

/// The main action of a screen: a wide orange pill that squeezes when pressed.
struct BouncyButtonStyle: ButtonStyle {
  /// White on an orange background, for use on top of the brand gradient.
  var isInverted = false

  func makeBody(configuration: Configuration) -> some View {
    Face(configuration: configuration, isInverted: isInverted)
  }

  // A view of its own, because only views read the environment reliably.
  private struct Face: View {
    let configuration: Configuration
    let isInverted: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
      configuration.label
        .font(.headline)
        .foregroundStyle(isInverted ? Color.brandDeep : .white)
        .frame(maxWidth: .infinity, minHeight: 50)
        .background(isInverted ? AnyShapeStyle(.white) : AnyShapeStyle(.brandGradient), in: .capsule)
        .opacity(isEnabled ? 1 : 0.55)
        .scaleEffect(configuration.isPressed ? 0.97 : 1)
        .animation(Motion.press, value: configuration.isPressed)
        .animation(Motion.swap, value: isEnabled)
    }
  }
}

/// A round orange button with one symbol, like the send button of the chat.
struct RoundButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    Face(configuration: configuration)
  }

  private struct Face: View {
    let configuration: Configuration
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
      configuration.label
        .labelStyle(.iconOnly)
        .font(.body.weight(.bold))
        .foregroundStyle(.white)
        .frame(width: 44, height: 44)
        .background(.brandGradient, in: .circle)
        .opacity(isEnabled ? 1 : 0.4)
        .scaleEffect(configuration.isPressed ? 0.92 : 1)
        .animation(Motion.press, value: configuration.isPressed)
        .animation(Motion.swap, value: isEnabled)
    }
  }
}

/// Anything that is pressed like a button but looks like a card: it gives a little and springs back.
struct PopButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(Motion.press, value: configuration.isPressed)
  }
}

extension ButtonStyle where Self == PopButtonStyle {
  static var pop: PopButtonStyle { PopButtonStyle() }
}

extension ButtonStyle where Self == BouncyButtonStyle {
  static var bouncy: BouncyButtonStyle { BouncyButtonStyle() }
  static var bouncyInverted: BouncyButtonStyle { BouncyButtonStyle(isInverted: true) }
}

extension ButtonStyle where Self == RoundButtonStyle {
  static var round: RoundButtonStyle { RoundButtonStyle() }
}

// MARK: - Surfaces

extension View {
  /// A white, round card on the paper background.
  func card(padding: CGFloat = 16) -> some View {
    self
      .padding(padding)
      .background(Color(.card), in: .rect(cornerRadius: 22, style: .continuous))
  }

  /// A text field as a round box of its own.
  func fieldBox() -> some View {
    self
      .padding(.horizontal, 16)
      .padding(.vertical, 13)
      .background(Color(.card), in: .rect(cornerRadius: 16, style: .continuous))
  }

  /// The warm paper background behind a form or a list, in place of the system's grey.
  func paperBackground() -> some View {
    self
      .scrollContentBackground(.hidden)
      .background(Color(.paper))
  }
}

// MARK: - Pieces

/// A stand-in icon for one of the person's apps: a tilted tile in a colour of its own, with the first letter.
struct AppTile: View {
  let name: String
  /// Decides the colour and the tilt, so an app keeps its look when it is renamed.
  let seed: String
  /// The app's own icon, shown in place of the letter once it has loaded.
  var icon: URL?

  private static let palette: [Color] = [
    Color(red: 0.93, green: 0.42, blue: 0.10), Color(red: 0.89, green: 0.27, blue: 0.47), Color(red: 0.55, green: 0.36, blue: 0.87),
    Color(red: 0.16, green: 0.60, blue: 0.62), Color(red: 0.22, green: 0.50, blue: 0.90), Color(red: 0.31, green: 0.65, blue: 0.33),
  ]

  private var number: Int { seed.utf8.reduce(0) { ($0 &* 31 &+ Int($1)) & 0xffff } }

  var body: some View {
    Group {
      if let icon {
        RemoteImage(url: icon) { letter }
      } else {
        letter
      }
    }
    .frame(width: 46, height: 46)
    .clipShape(.rect(cornerRadius: 13, style: .continuous))
    .rotationEffect(.degrees(number % 2 == 0 ? -7 : 7))
    .accessibilityHidden(true)
  }

  private var letter: some View {
    Rectangle()
      .fill(Self.palette[number % Self.palette.count].gradient)
      .overlay {
        Text(name.trimmingCharacters(in: .whitespaces).prefix(1).uppercased())
          .font(.title3.weight(.heavy))
          .foregroundStyle(.white)
      }
  }
}

/// A picture from the server, with something to show until it has arrived. Unlike AsyncImage it
/// fetches again when a first try was cut short, which happens to rows of a list that is redrawn
/// while its pictures are on their way.
struct RemoteImage<Placeholder: View>: View {
  let url: URL
  @ViewBuilder var placeholder: Placeholder

  @State private var image: UIImage?

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable()
      } else {
        placeholder
      }
    }
    .task(id: url) {
      image = nil
      for attempt in 0..<3 {
        if attempt > 0 { try? await Task.sleep(for: .seconds(Double(attempt))) }
        if Task.isCancelled { return }
        if let (data, response) = try? await URLSession.shared.data(from: url),
          (response as? HTTPURLResponse)?.statusCode == 200,
          let loaded = UIImage(data: data)
        {
          image = loaded
          return
        }
      }
    }
  }
}

/// The mascot with a line or two under it: for a screen that has nothing to show yet, or is working.
struct MascotNote<Actions: View>: View {
  let title: Text
  var message: Text?
  var isDancing = false
  @ViewBuilder var actions: Actions

  var body: some View {
    VStack(spacing: 14) {
      Mascot(isDancing: isDancing)
        .frame(width: 120)
      title
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
      if let message {
        message
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      actions
    }
    .padding(24)
    .frame(maxWidth: 340)
  }
}

extension MascotNote where Actions == EmptyView {
  init(title: Text, message: Text? = nil, isDancing: Bool = false) {
    self.init(title: title, message: message, isDancing: isDancing) { EmptyView() }
  }
}
