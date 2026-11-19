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
    NavigationStack {
      Form {
        Section {
          TextField("E-post", text: $email)
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          SecureField("Lösenord", text: $password)
            .textContentType(mode == .logIn ? .password : .newPassword)
          if mode == .signUp && inviteRequired {
            TextField("Inbjudningskod", text: $inviteCode)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
        } header: {
          Text("Beskriv din idé. Få en riktig iPhone-app.")
            .textCase(nil)
        } footer: {
          if mode == .signUp { Text("Lösenordet ska ha minst 8 tecken.") }
        }

        if let errorText {
          Section {
            Text(errorText).foregroundStyle(.red)
          }
        }

        Section {
          Button(mode == .logIn ? "Logga in" : "Skapa konto") { submit() }
            .disabled(!canSubmit)
          Button(mode == .logIn ? "Ny här? Skapa konto" : "Har du redan ett konto? Logga in") {
            mode = mode == .logIn ? .signUp : .logIn
            errorText = nil
          }
          .font(.footnote)
        }
      }
      .navigationTitle("Appsmedjan")
      .task {
        inviteRequired = (try? await model.api.inviteRequired()) ?? false
      }
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
