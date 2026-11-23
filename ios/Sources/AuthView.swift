// The way in, and the first thing a new person sees: a short film of what the service does, and
// after it the form to make an account or sign in.
import SwiftUI

struct AuthView: View {
  private enum Mode { case logIn, signUp }

  @Environment(AppModel.self) private var model
  // Someone who has just got the app is new here; whoever has an account is one tap from signing in.
  @State private var mode = Mode.signUp
  @State private var email = ""
  @State private var password = ""
  @State private var inviteCode = ""
  @State private var inviteRequired = false
  @State private var paywall = false
  @State private var isBusy = false
  @State private var errorText: String?
  /// False while the short film of what the service does is playing; the form comes after it.
  @State private var isPastIntro = false
  @FocusState private var isOnEmail: Bool

  private var canSubmit: Bool {
    !isBusy && email.contains("@") && password.count >= 8 && (mode == .logIn || !inviteRequired || !inviteCode.isEmpty)
  }

  private static let steps: [(title: String, text: String)] = [
    (String(localized: "Beskriv din idé"), String(localized: "Med egna ord, som i ett sms.")),
    (String(localized: "Se den byggas"), String(localized: "Det tar några minuter, och du ser vad som händer.")),
    (String(localized: "Prova den direkt"), String(localized: "Appen öppnas hos dig så fort den är klar.")),
  ]

  private static let facts = [
    String(localized: "Ingen kod, inga förkunskaper"),
    String(localized: "En riktig iPhone-app, inte en webbsida"),
    String(localized: "Vill du ha den i App Store? Vi visar vägen."),
  ]

  var body: some View {
    ZStack {
      if isPastIntro {
        signIn
          .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 1.04)), removal: .opacity))
      } else {
        IntroView { isNew in
          mode = isNew ? .signUp : .logIn
          withAnimation(.spring(duration: 0.55, bounce: 0.1)) { isPastIntro = true }
        }
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
      }
    }
    .task {
      if let welcome = try? await model.api.welcome() {
        inviteRequired = welcome.inviteRequired
        paywall = welcome.paywall
      }
    }
  }

  private var signIn: some View {
    ScrollView {
      VStack(spacing: 0) {
        hero
        form
          .padding(20)
        how
          .padding(.horizontal, 20)
          .padding(.bottom, 28)
      }
    }
    .background(Color(.paper))
    // The orange runs up behind the status bar.
    .ignoresSafeArea(edges: .top)
    .scrollDismissesKeyboard(.interactively)
    // The way back to the film, for whoever wants to see it again.
    .overlay(alignment: .topLeading) {
      Button("Se hur det går till", systemImage: "chevron.backward") {
        withAnimation(.spring(duration: 0.55, bounce: 0.1)) { isPastIntro = false }
      }
      .labelStyle(.iconOnly)
      .font(.body.weight(.bold))
      .foregroundStyle(.white)
      .frame(width: 44, height: 44)
      .background(.white.opacity(0.2), in: .circle)
      .padding(.leading, 16)
    }
    .task {
      // Ready to write in, so that the next thing to do is plain.
      try? await Task.sleep(for: .seconds(0.6))
      isOnEmail = true
    }
  }

  /// The film before this has said what the service does; here the mascot and a line are enough.
  private var hero: some View {
    VStack(spacing: 8) {
      Mascot(tile: .white, eyes: .brandDeep, isDancing: true)
        .frame(width: 92)
      Text("Beskriv din app.\nSe den bli till.")
        .font(.title.weight(.heavy))
        .multilineTextAlignment(.center)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, 24)
    .padding(.top, 64)
    .padding(.bottom, 24)
    .frame(maxWidth: .infinity)
    .background(.brandGradient, in: .rect(bottomLeadingRadius: 40, bottomTrailingRadius: 40, style: .continuous))
  }

  private var form: some View {
    VStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(mode == .signUp ? "Kom igång" : "Välkommen tillbaka")
          .font(.title2.weight(.heavy))
        if mode == .signUp {
          Text(paywall ? "Det kostar inget att skapa konto. Du väljer plan först när du vill bygga din första app." : "Det kostar inget att skapa konto.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 4)

      TextField("E-post", text: $email)
        .focused($isOnEmail)
        .textContentType(.username)
        .keyboardType(.emailAddress)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .fieldBox()
      SecureField("Lösenord", text: $password)
        .textContentType(mode == .logIn ? .password : .newPassword)
        .fieldBox()
      if mode == .signUp && inviteRequired {
        TextField("Inbjudningskod", text: $inviteCode)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .fieldBox()
      }
      if mode == .signUp {
        Text("Lösenordet ska ha minst 8 tecken.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
      }

      if let errorText {
        Text(errorText)
          .font(.footnote)
          .foregroundStyle(.red)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
      }

      Button { submit() } label: {
        if isBusy { ProgressView().tint(.white) } else { Text(mode == .logIn ? "Logga in" : "Skapa konto") }
      }
      .buttonStyle(.bouncy)
      .disabled(!canSubmit)
      .padding(.top, 6)

      Button(mode == .logIn ? "Ny här? Skapa konto" : "Har du redan ett konto? Logga in") {
        withAnimation(.bouncy(duration: 0.35)) {
          mode = mode == .logIn ? .signUp : .logIn
          errorText = nil
        }
      }
      .font(.subheadline.weight(.semibold))
      .padding(.top, 6)
    }
  }

  /// How it goes, in three steps, and what is worth knowing before starting.
  private var how: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Så går det till")
        .font(.headline)
      ForEach(Array(Self.steps.enumerated()), id: \.offset) { index, step in
        HStack(alignment: .top, spacing: 12) {
          Text(verbatim: "\(index + 1)")
            .font(.subheadline.weight(.heavy))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(.brandGradient, in: .circle)
          VStack(alignment: .leading, spacing: 2) {
            Text(step.title)
              .font(.subheadline.weight(.bold))
            Text(step.text)
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
        }
        .accessibilityElement(children: .combine)
      }
      VStack(alignment: .leading, spacing: 8) {
        ForEach(Self.facts, id: \.self) { fact in
          Label(fact, systemImage: "checkmark.circle.fill")
            .font(.subheadline.weight(.medium))
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(Color.brand)
        }
      }
      .padding(.top, 2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card(padding: 20)
  }

  private func submit() {
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        switch mode {
        case .logIn: try await model.logIn(email: email, password: password)
        case .signUp: try await model.signUp(email: email, password: password, inviteCode: inviteCode)
        }
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}
