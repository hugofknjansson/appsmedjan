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
        .scaleEffect(configuration.isPressed ? 0.95 : 1)
        .animation(.bouncy(duration: 0.3), value: configuration.isPressed)
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
        .scaleEffect(configuration.isPressed ? 0.88 : 1)
        .animation(.bouncy(duration: 0.3), value: configuration.isPressed)
    }
  }
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
        AsyncImage(url: icon) { image in
          image.resizable()
        } placeholder: {
          letter
        }
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
