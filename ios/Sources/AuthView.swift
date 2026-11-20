import SwiftUI

struct AuthView: View {
  private enum Mode { case logIn, signUp }

  @Environment(AppModel.self) private var model
  @State private var mode = Mode.logIn
  @State private var email = ""
  @State private var password = ""
  @State private var inviteCode = ""
  @State private var inviteRequired = false
  @State private var isBusy = false
  @State private var errorText: String?

  private var canSubmit: Bool {
    !isBusy && email.contains("@") && password.count >= 8 && (mode == .logIn || !inviteRequired || !inviteCode.isEmpty)
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        hero
        form
          .padding(20)
      }
    }
    .background(Color(.paper))
    // The orange runs up behind the status bar.
    .ignoresSafeArea(edges: .top)
    .scrollDismissesKeyboard(.interactively)
    .task {
      inviteRequired = (try? await model.api.inviteRequired()) ?? false
    }
  }

  private var hero: some View {
    VStack(spacing: 6) {
      Mascot(tile: .white, eyes: .brandDeep, isDancing: true)
        .frame(width: 170)
      Text("App Dance")
        .font(.largeTitle.weight(.heavy))
      Text("Beskriv din idé. Få en riktig iPhone-app.")
        .font(.callout.weight(.medium))
        .opacity(0.92)
        .multilineTextAlignment(.center)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, 24)
    .padding(.top, 76)
    .padding(.bottom, 32)
    .frame(maxWidth: .infinity)
    .background(.brandGradient, in: .rect(bottomLeadingRadius: 40, bottomTrailingRadius: 40, style: .continuous))
  }

  private var form: some View {
    VStack(spacing: 12) {
      TextField("E-post", text: $email)
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
