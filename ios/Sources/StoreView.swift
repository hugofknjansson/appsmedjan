// The App Store guide: texts, pages, screenshots, icon and the details Apple asks for, then sending
// the page to App Store Connect and submitting the app for review.
import PhotosUI
import SwiftUI

struct StoreView: View {
  @State private var model: StoreModel
  @State private var pickedPhoto: PhotosPickerItem?
  @State private var isConfirmingDraft = false
  @State private var isConfirmingSubmit = false
  @Environment(\.dismiss) private var dismiss

  private static let connect = URL(string: "https://appstoreconnect.apple.com/apps")!

  init(projectID: String, api: API) {
    _model = State(initialValue: StoreModel(projectID: projectID, api: api))
  }

  var body: some View {
    NavigationStack {
      Group {
        if let state = model.state {
          form(state)
        } else if let errorText = model.errorText {
          ContentUnavailableView(errorText, systemImage: "wifi.exclamationmark")
        } else {
          ProgressView()
        }
      }
      .paperBackground()
      .navigationTitle("App Store")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Spara") { Task { await model.save() } }
            .disabled(!model.isDirty || model.isBusy)
        }
      }
      .task { await model.load() }
      .task { await model.follow() }
      .onChange(of: pickedPhoto) { _, item in
        guard let item else { return }
        Task {
          if let data = try? await item.loadTransferable(type: Data.self) { await model.setIcon(from: data) }
          pickedPhoto = nil
        }
      }
    }
  }

  private func form(_ state: StoreState) -> some View {
    Form {
      Section {
        Text("Här förbereder du det som syns i App Store. När allt är ifyllt skickas det till App Store Connect, där du läser igenom och sedan skickar in appen för granskning.")
          .foregroundStyle(.secondary)
        if let errorText = model.errorText {
          Text(errorText).foregroundStyle(.red)
        }
      }
      texts
      pagesSection
      screenshots(state)
      icon(state)
      details
      sendSection(state)
      reviewSection(state)
    }
    .scrollDismissesKeyboard(.interactively)
  }

  // MARK: - Texts

  private var texts: some View {
    @Bindable var model = model
    return Section {
      Button {
        let written = [model.listing.name, model.listing.subtitle, model.listing.promo, model.listing.description, model.listing.keywords, model.pages.privacyText]
        if written.contains(where: { !$0.isEmpty }) { isConfirmingDraft = true } else { Task { await model.draft() } }
      } label: {
        if model.activity == .drafting {
          Label("Skriver förslag", systemImage: "sparkles")
        } else {
          Label("Föreslå texter från appen", systemImage: "sparkles")
        }
      }
      .disabled(model.isBusy)
      .confirmationDialog("Det ersätter texterna du har skrivit.", isPresented: $isConfirmingDraft, titleVisibility: .visible) {
        Button("Ersätt texterna") { Task { await model.draft() } }
      }

      Counted("Namn", text: $model.listing.name, limit: StoreListing.Limit.name)
      Counted("Underrubrik", text: $model.listing.subtitle, limit: StoreListing.Limit.subtitle)
      Counted("Kampanjtext", text: $model.listing.promo, limit: StoreListing.Limit.promo, lines: 2...4)
      Counted("Beskrivning", text: $model.listing.description, limit: StoreListing.Limit.description, lines: 5...12)
      Counted("Sökord, med komma emellan", text: $model.listing.keywords, limit: StoreListing.Limit.keywords, lines: 1...3)
      Picker("Kategori", selection: $model.listing.category) {
        Text("Välj kategori").tag("")
        ForEach(Texts.categories, id: \.id) { category in
          Text(category.name).tag(category.id)
        }
      }
    } header: {
      Text("Texter")
    } footer: {
      Text("Förslaget bygger på appens kod. Läs igenom det: du står för det som publiceras.")
    }
  }

  // MARK: - Support page and privacy policy

  private var pagesSection: some View {
    @Bindable var model = model
    return Section {
      Picker("Sidor", selection: Binding(get: { model.pages.hosted }, set: { model.hostPages($0) })) {
        Text("App Dance visar dem").tag(true)
        Text("Jag har egna").tag(false)
      }
      .pickerStyle(.segmented)

      if model.pages.hosted {
        TextField("E-post för support", text: $model.pages.supportEmail)
          .textContentType(.emailAddress)
          .keyboardType(.emailAddress)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
        Counted("Integritetspolicy", text: $model.pages.privacyText, limit: StoreListing.Limit.policy, lines: 5...12)
        if !model.isDirty, let support = URL(string: model.hostedURL("support")), let privacy = URL(string: model.hostedURL("privacy")) {
          Link("Visa supportsidan", destination: support)
          Link("Visa integritetspolicyn", destination: privacy)
        }
      } else {
        address("Supportsida, https://", text: $model.listing.supportUrl)
        address("Integritetspolicy, https://", text: $model.listing.privacyUrl)
      }
      address("Webbplats, https:// (valfritt)", text: $model.listing.marketingUrl)
    } header: {
      Text("Supportsida och integritetspolicy")
    } footer: {
      if model.pages.hosted {
        Text("Apple kräver båda. E-postadressen visas öppet på sidorna, tillsammans med ditt namn om du har fyllt i kontaktuppgifterna. Du ansvarar för att policyn stämmer.")
      } else {
        Text("Apple kräver att varje app har en supportsida och en integritetspolicy på webben.")
      }
    }
  }

  private func address(_ title: LocalizedStringKey, text: Binding<String>) -> some View {
    TextField(title, text: text)
      .textContentType(.URL)
      .keyboardType(.URL)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
  }

  // MARK: - Screenshots and icon

  private func screenshots(_ state: StoreState) -> some View {
    Section {
      if state.screenshots.isEmpty {
        Text("Inga skärmbilder än.").foregroundStyle(.secondary)
      } else {
        ScrollView(.horizontal) {
          HStack(spacing: 10) {
            ForEach(state.screenshots, id: \.self) { shot in
              AsyncImage(url: model.api.screenshotURL(model.projectID, shot: shot)) { image in
                image.resizable().aspectRatio(contentMode: .fit)
              } placeholder: {
                Color.secondary.opacity(0.15)
              }
              .frame(width: 92, height: 200)
              .clipShape(.rect(cornerRadius: 10))
              .overlay(alignment: .topTrailing) {
                Button("Ta bort skärmbilden", systemImage: "xmark.circle.fill") {
                  Task { await model.deleteScreenshot(shot) }
                }
                .labelStyle(.iconOnly)
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .black.opacity(0.6))
                .padding(4)
                .disabled(model.isBusy)
              }
            }
          }
        }
        .scrollIndicators(.hidden)
      }
    } header: {
      Text("Skärmbilder")
    } footer: {
      Text("Gå till den skärm du vill visa i förhandsvisningen och tryck på kameran där. Minst en bild behövs, högst tio.")
    }
  }

  private func icon(_ state: StoreState) -> some View {
    Section {
      HStack(spacing: 14) {
        Group {
          if state.hasIcon, var parts = URLComponents(url: model.api.iconURL(model.projectID), resolvingAgainstBaseURL: false) {
            // The version makes the picture load again after a change.
            let _ = parts.queryItems = [URLQueryItem(name: "v", value: String(model.iconVersion))]
            AsyncImage(url: parts.url) { image in
              image.resizable()
            } placeholder: {
              Color.secondary.opacity(0.15)
            }
          } else {
            Image(systemName: "app.dashed").font(.largeTitle).foregroundStyle(.secondary)
          }
        }
        .frame(width: 64, height: 64)
        .clipShape(.rect(cornerRadius: 14))

        PhotosPicker("Välj ikon", selection: $pickedPhoto, matching: .images)
          .disabled(model.isBusy)
        if state.hasIcon {
          Button("Ta bort", role: .destructive) { Task { await model.removeIcon() } }
            .disabled(model.isBusy)
        }
      }
      .buttonStyle(.borderless)
    } header: {
      Text("Appikon")
    } footer: {
      Text("Bilden görs kvadratisk och används från nästa version du gör installerbar. Utan egen ikon får appen en enkel platshållare.")
    }
  }

  // MARK: - Details for Apple

  @ViewBuilder
  private var details: some View {
    @Bindable var model = model
    Section {
      Toggle("Appen innehåller inget av det Apple frågar om för åldersgränsen", isOn: $model.choices.noMatureContent)
      if let notes = model.ageNotes {
        if notes.isEmpty {
          Text("Förslaget hittade inget sådant i appens kod.").font(.footnote).foregroundStyle(.secondary)
        } else {
          VStack(alignment: .leading, spacing: 4) {
            Text("Förslaget hittade det här i appens kod. Sätt i så fall åldersgränsen själv i App Store Connect:")
            ForEach(notes, id: \.self) { Text("• \($0)") }
          }
          .font(.footnote)
        }
      }
      Toggle("Appen visar inget material från andra som jag saknar rätt att använda", isOn: $model.choices.noThirdPartyContent)
      Toggle("Appen ska vara gratis och finnas i alla länder", isOn: $model.choices.free)
    } header: {
      Text("Uppgifter till Apple")
    } footer: {
      Text("Slå bara på det som stämmer. Inget våld, inga vapen, inget sexuellt eller skrämmande innehåll, inget grovt språk, inga droger, inget spel om pengar, inga medicinska råd, ingen fri webbläsare, inget innehåll från andra användare och ingen reklam ger åldersgränsen 4+. Det du lämnar av fyller du i själv i App Store Connect.")
    }

    Section {
      ContactFields(contact: $model.contact)
      TextField("Upphovsrättsinnehavare (valfritt)", text: $model.contact.holder)
    } header: {
      Text("Kontakt för granskningen")
    } footer: {
      if let problem = model.contact.problem {
        Text(Texts.contactProblem(problem))
      } else {
        Text("Apple hör av sig till den här personen om något är oklart. Uppgifterna används för alla dina appar.")
      }
    }
  }

  // MARK: - Sending and submitting

  private func sendSection(_ state: StoreState) -> some View {
    Section {
      if state.account == .none {
        Text("Koppla ditt Apple-utvecklarkonto för att kunna skicka sidan. Du kan förbereda allt här redan nu.")
      } else if !state.available {
        Text("Ingen byggserver som kan nå Apple är ansluten just nu.").foregroundStyle(.secondary)
      }
      if model.isDirty {
        Text("Du har ändringar som inte är sparade. De sparas innan sidan skickas.").foregroundStyle(.secondary)
      } else if !state.problems.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          Text("Det här behöver rättas först:")
          ForEach(state.problems, id: \.self) { Text("• \(Texts.listingProblem($0))") }
        }
        .foregroundStyle(.red)
      }

      Button {
        Task { await model.send() }
      } label: {
        if model.isSyncing {
          Label(Texts.storeStage(state.sync.stage), systemImage: "arrow.up.circle")
        } else {
          Text("Skicka till App Store Connect")
        }
      }
      .disabled(model.isBusy || model.isSyncing || state.account == .none || !state.available || (!model.isDirty && !state.problems.isEmpty))

      switch state.sync.status {
      case .done:
        Label(Texts.attached(state.sync.attached, build: state.build ?? ""), systemImage: "checkmark.circle")
          .foregroundStyle(.green)
      case .failed:
        Text(Texts.storeError(state.sync.error, detail: state.sync.detail, submitting: false)).foregroundStyle(.red)
      case .idle, .working:
        EmptyView()
      }
    } header: {
      Text("Skicka")
    } footer: {
      if state.account != .none && state.build == nil {
        Text("Appen är inte uppladdad än. Gör den installerbar först, så finns det ett bygge att välja.")
      }
    }
  }

  private func reviewSection(_ state: StoreState) -> some View {
    Section {
      VStack(alignment: .leading, spacing: 6) {
        Text("Det här går bara att göra i App Store Connect. Gör det där först:")
        Text("• Svara på frågorna om integritet (App Privacy).")
        if model.listing.category == "HEALTH_AND_FITNESS" || model.listing.category == "MEDICAL" {
          Text("• Ange om appen är en medicinteknisk produkt (App Compliance). För en vanlig app är svaret nej.")
        }
        if !model.choices.noMatureContent { Text("• Svara på frågorna om åldersgräns.") }
        if !model.choices.noThirdPartyContent { Text("• Ange om appen visar material från andra.") }
        if !model.choices.free { Text("• Välj pris och länder.") }
      }
      Link("Öppna App Store Connect", destination: Self.connect)

      Button {
        isConfirmingSubmit = true
      } label: {
        if model.isSubmitting {
          Label("Skickar in", systemImage: "paperplane")
        } else {
          Text("Skicka in för granskning")
        }
      }
      .disabled(model.isBusy || model.isSubmitting || model.isSyncing || model.isDirty || !state.canSubmit)
      .confirmationDialog(
        "Appen skickas nu in till Apple för granskning, i utvecklarkontots namn.",
        isPresented: $isConfirmingSubmit,
        titleVisibility: .visible
      ) {
        Button("Skicka in") { Task { await model.submit() } }
      } message: {
        Text("Har du läst igenom sidan i App Store Connect och svarat på integritetsfrågorna?")
      }

      switch state.submit.status {
      case .done:
        Label("Appen är inskickad för granskning. Apple hör av sig till kontaktpersonen, oftast inom ett par dagar.", systemImage: "checkmark.circle")
          .foregroundStyle(.green)
      case .failed:
        VStack(alignment: .leading, spacing: 6) {
          Text(Texts.storeError(state.submit.error, detail: state.submit.detail, submitting: true))
          ForEach(Texts.refusalHints(state.submit.detail ?? ""), id: \.self) { Text("• \($0)") }
        }
        .foregroundStyle(.red)
      case .idle, .working:
        EmptyView()
      }
    } header: {
      Text("Skicka in för granskning")
    } footer: {
      if !state.canSubmit && state.submit.status != .done {
        Text("Knappen går att trycka på när sidan är skickad med ett bygge valt, kontaktuppgifterna är ifyllda och inget har ändrats sedan dess.")
      }
    }
  }
}

/// A text field that shows how much of Apple's limit is used, and turns red past it.
private struct Counted: View {
  let title: LocalizedStringKey
  @Binding var text: String
  let limit: Int
  var lines: ClosedRange<Int> = 1...1

  init(_ title: LocalizedStringKey, text: Binding<String>, limit: Int, lines: ClosedRange<Int> = 1...1) {
    self.title = title
    _text = text
    self.limit = limit
    self.lines = lines
  }

  var body: some View {
    VStack(alignment: .trailing, spacing: 2) {
      TextField(title, text: $text, axis: .vertical)
        .lineLimit(lines)
      // Characters as people count them, which is how Apple counts too.
      Text("\(text.count)/\(limit)")
        .font(.caption2)
        .monospacedDigit()
        .foregroundStyle(text.count > limit ? .red : .secondary)
    }
  }
}
