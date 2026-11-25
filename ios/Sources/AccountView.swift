// The person's account: their address, whether it is confirmed, and deleting the account with
// everything in it. Apple asks that an app where an account is made also lets it be deleted there.
import SwiftUI

struct AccountView: View {
  let user: User

  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var password = ""
  @State private var isBusy = false
  @State private var isAsking = false
  @State private var errorText: String?
  @State private var sentText: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          LabeledContent("E-post", value: user.email)
          if user.emailVerified == false {
            Text("Inte bekräftad än. Vi har skickat en länk till din adress.")
              .font(.footnote)
              .foregroundStyle(.secondary)
            if let sentText {
              Text(sentText)
                .font(.footnote)
            } else {
              Button("Skicka bekräftelsen igen") { sendAgain() }
                .disabled(isBusy)
            }
          }
        }

        Section {
          SecureField("Ditt lösenord", text: $password)
            .textContentType(.password)
          Button("Radera mitt konto", role: .destructive) { isAsking = true }
            .disabled(isBusy || password.isEmpty)
          if let errorText {
            Text(errorText)
              .font(.footnote)
              .foregroundStyle(.red)
          }
        } header: {
          Text("Radera kontot")
        } footer: {
          Text("Allt försvinner: dina appar, chattarna, telefonerna du har lagt till, din plan och dina credits. Det går inte att ångra.")
        }
      }
      .navigationTitle("Mitt konto")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
      }
      .confirmationDialog("Radera kontot och allt i det för alltid?", isPresented: $isAsking, titleVisibility: .visible) {
        Button("Radera mitt konto", role: .destructive) { delete() }
      }
    }
  }

  private func sendAgain() {
    isBusy = true
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        let status = try await model.api.verifyAgain()
        sentText = switch status {
        case "too_soon": String(localized: "Vi skickade nyss ett mejl. Vänta en minut och försök igen.")
        case "not_sent": String(localized: "Tjänsten kan inte skicka mejl just nu. Hör av dig till den som driver den.")
        default: String(localized: "Skickat! Titta i inkorgen, och i skräpposten.")
        }
      } catch {
        sentText = Texts.apiError(error.code)
      }
    }
  }

  private func delete() {
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        try await model.deleteAccount(password: password)
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}
