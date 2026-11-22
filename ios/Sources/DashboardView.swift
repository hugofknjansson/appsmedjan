import SwiftUI

struct DashboardView: View {
  let user: User

  @Environment(AppModel.self) private var model
  @State private var projects: [ProjectSummary] = []
  @State private var hasLoaded = false
  @State private var prompt = ""
  @State private var isCreating = false
  @State private var errorText: String?
  @State private var notice: String?
  @State private var path: [ProjectSummary] = []
  @State private var requests: [AppRequest] = []
  @State private var isShowingAccount = false
  @State private var isShowingPlan = false
  @FocusState private var isWriting: Bool
  /// Counts the ideas picked, so each pick is felt as a tick.
  @State private var picks = 0

  private var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// What the mascot says: a greeting, a nudge once there is an idea, and that it has started.
  private var speech: String {
    if isCreating { return String(localized: "Jag sätter igång!") }
    if trimmedPrompt.isEmpty { return String(localized: "Hej! Vad vill du bygga?") }
    return String(localized: "Det låter kul. Tryck på Bygg min app!")
  }

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section {
          startCard
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
          steps
            .listRowInsets(EdgeInsets(top: 14, leading: 4, bottom: 4, trailing: 4))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } footer: {
          if let errorText {
            Text(errorText).foregroundStyle(.red)
          } else if let notice {
            Text(notice)
          }
        }

        Section("Behöver du en idé?") {
          ideas
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }

        if !projects.isEmpty {
          Section("Dina appar") {
            ForEach(projects) { project in
              NavigationLink(value: project) {
                HStack(spacing: 14) {
                  AppTile(name: project.name, seed: project.id, icon: model.api.iconURL(project.id, changedAt: project.icon))
                  VStack(alignment: .leading, spacing: 2) {
                    Text(project.name).font(.headline)
                    Text("Ändrad \(project.updated.formatted(date: .abbreviated, time: .omitted))")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                }
                .padding(.vertical, 4)
              }
              .listRowBackground(Color(.card))
            }
            .onDelete(perform: delete)
          }
        }

        // Only for the people who run the service, and nothing a new app starts from: last.
        if !requests.isEmpty {
          Section {
            ForEach(requests) { request in
              VStack(alignment: .leading, spacing: 2) {
                Text(request.name).font(.headline)
                Text(request.bundleId).font(.footnote.monospaced()).textSelection(.enabled)
                Text(request.email).font(.caption).foregroundStyle(.secondary)
              }
              .listRowBackground(Color(.card))
            }
            Link("Öppna App Store Connect", destination: URL(string: "https://appstoreconnect.apple.com/apps")!)
              .fontWeight(.semibold)
              .listRowBackground(Color(.card))
          } header: {
            Text("Appar att skapa i App Store Connect")
          } footer: {
            Text("De här väntar på att du skapar appen hos Apple. Välj bundle-id:t i listan när du skapar den.")
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .sensoryFeedback(.selection, trigger: picks)
      .paperBackground()
      .navigationTitle("App Dance")
      .navigationDestination(for: ProjectSummary.self) { project in
        ProjectView(project: project, api: model.api)
      }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Text(user.email)
            Button("Min plan", systemImage: "star.circle") { isShowingPlan = true }
            Button("Apple-utvecklarkonto", systemImage: "person.badge.key") { isShowingAccount = true }
            Button("Logga ut", role: .destructive) {
              Task { await model.logOut() }
            }
          } label: {
            Label("Konto", systemImage: "person.crop.circle")
          }
        }
      }
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Klar") { isWriting = false }
        }
      }
      .sheet(isPresented: $isShowingAccount) {
        AppleAccountView(api: model.api)
      }
      .sheet(isPresented: $isShowingPlan) {
        // Let past the paywall with a code: on with the app the person was about to build.
        PlanView(api: model.api) {
          if !trimmedPrompt.isEmpty { create() }
        }
      }
      .refreshable { await load() }
      .task { await load() }
      // Names change while the agent works, so the list is read again when coming back to it.
      .onChange(of: path) { _, new in
        if new.isEmpty { Task { await load() } }
      }
    }
  }

  /// Where an app starts: the mascot says hello and asks, there is one place to write and one button.
  private var startCard: some View {
    VStack(spacing: 14) {
      HStack(alignment: .center, spacing: 6) {
        // It waves until there is an idea, dances once there is one, and cheers when the app is on its way.
        Mascot(tile: .white, eyes: .brandDeep, isDancing: !trimmedPrompt.isEmpty, isCheering: isCreating, isWaving: true)
          .frame(width: 104)
        Text(speech)
          .font(.title3.weight(.heavy))
          .foregroundStyle(.primary)
          .padding(.horizontal, 16)
          .padding(.vertical, 12)
          .background(Color(.card), in: .rect(topLeadingRadius: 20, bottomLeadingRadius: 6, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous))
          .frame(maxWidth: .infinity, alignment: .leading)
          .id(speech)
          .transition(.scale(scale: 0.8, anchor: .leading).combined(with: .opacity))
      }
      .animation(.bouncy(duration: 0.4), value: speech)

      TextField("Beskriv din app med egna ord", text: $prompt, axis: .vertical)
        .lineLimit(3...8)
        .focused($isWriting)
        .fieldBox()

      Button {
        isWriting = false
        create()
      } label: {
        if isCreating { ProgressView().tint(.brandDeep) } else { Text("Bygg min app") }
      }
      .buttonStyle(.bouncyInverted)
      .disabled(isCreating || trimmedPrompt.isEmpty)

      if trimmedPrompt.isEmpty {
        Text("Skriv en idé här ovanför, eller välj ett förslag längre ned.")
          .font(.footnote.weight(.medium))
          .foregroundStyle(.white.opacity(0.92))
          .multilineTextAlignment(.center)
      }
    }
    .padding(18)
    .background(.brandGradient, in: .rect(cornerRadius: 28, style: .continuous))
  }

  /// The whole way in three steps, so nobody wonders what happens after the button.
  private var steps: some View {
    HStack(alignment: .top, spacing: 6) {
      ForEach(Array(Self.stepTitles.enumerated()), id: \.offset) { index, title in
        VStack(spacing: 6) {
          Text(verbatim: "\(index + 1)")
            .font(.subheadline.weight(.heavy))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(.brandGradient, in: .circle)
          Text(title)
            .font(.caption.weight(.semibold))
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        if index < Self.stepTitles.count - 1 {
          Image(systemName: "chevron.right")
            .font(.caption.weight(.bold))
            .foregroundStyle(.tertiary)
            .padding(.top, 9)
            .accessibilityHidden(true)
        }
      }
    }
  }

  private static let stepTitles = [
    String(localized: "Beskriv din idé"),
    String(localized: "Vi bygger den"),
    String(localized: "Du provar den direkt"),
  ]

  /// Ideas to start from, as cards to press: each one writes itself into the box above.
  private var ideas: some View {
    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
      ForEach(Array(Idea.all.enumerated()), id: \.element.id) { index, idea in
        IdeaCard(title: idea.title, symbol: idea.symbol, color: Idea.colors[index % Idea.colors.count]) { pick(idea.prompt) }
      }
      IdeaCard(title: String(localized: "Överraska mig"), symbol: "dice.fill", color: nil) {
        // Not the one that is already there.
        pick(Idea.surprises.filter { $0 != prompt }.randomElement() ?? Idea.surprises[0])
      }
    }
  }

  private func pick(_ idea: String) {
    withAnimation(.bouncy(duration: 0.35)) { prompt = idea }
    picks += 1
  }

  private func load() async {
    do throws(APIError) {
      projects = try await model.api.projects()
      hasLoaded = true
      // Only people who run the service get an answer; for everyone else there is nothing to show.
      requests = (try? await model.api.operatorRequests()) ?? []
      let status = try await model.api.status()
      notice = if !status.agentReady {
        String(localized: "Tjänsten saknar API-nyckel, så appar kan inte byggas ännu.")
      } else if status.workers == 0 {
        String(localized: "Ingen byggserver är ansluten, så förhandsvisningen är avstängd just nu.")
      } else {
        nil
      }
    } catch {
      errorText = Texts.apiError(error.code)
    }
  }

  private func create() {
    isCreating = true
    errorText = nil
    Task {
      defer { isCreating = false }
      do throws(APIError) {
        let project = try await model.api.createProject(prompt: trimmedPrompt, name: String(localized: "Ny app"))
        prompt = ""
        projects.insert(project, at: 0)
        path = [project]
      } catch {
        // The plan does not hold this: the answer is the plans, or the paywall, and not a line of red.
        if error.code.hasPrefix("plan_") {
          isShowingPlan = true
        } else {
          errorText = Texts.apiError(error.code)
        }
      }
    }
  }

  private func delete(at offsets: IndexSet) {
    let doomed = offsets.map { projects[$0] }
    projects.remove(atOffsets: offsets)
    Task {
      for project in doomed {
        try? await model.api.deleteProject(project.id)
      }
    }
  }
}

/// Something to start from for a person who has no idea of their own yet.
private struct Idea: Identifiable {
  let title: String
  let symbol: String
  let prompt: String
  var id: String { title }

  static let all = [
    Idea(title: String(localized: "Växter"), symbol: "leaf.fill", prompt: String(localized: "En app där jag håller koll på mina växter och när de ska vattnas")),
    Idea(title: String(localized: "Vanor"), symbol: "checkmark.circle.fill", prompt: String(localized: "En app där jag bockar av mina dagliga vanor och ser hur många dagar i rad jag har klarat")),
    Idea(title: String(localized: "Spelkväll"), symbol: "trophy.fill", prompt: String(localized: "En poängräknare för spelkvällar med flera spelare och en topplista")),
    Idea(title: String(localized: "Packlista"), symbol: "suitcase.fill", prompt: String(localized: "En packlista för resor där jag bockar av det jag har packat")),
    Idea(title: String(localized: "Recept"), symbol: "fork.knife", prompt: String(localized: "En receptbok där jag sparar mina favoriter och får en inköpslista")),
  ]

  /// What "Surprise me" picks from: ideas nobody would have typed, but might like.
  static let surprises = [
    String(localized: "En app som slumpar vad vi ska äta till middag"),
    String(localized: "En poängtavla för vem som diskar mest hemma"),
    String(localized: "En app där jag samlar roliga citat från mina vänner"),
    String(localized: "En app som ger mig en ny komplimang varje dag"),
    String(localized: "En nedräkning till min nästa semester"),
    String(localized: "En träningsdagbok med en svit som jag inte vill bryta"),
  ]

  /// The colours of the app tiles, one for each idea in turn.
  static let colors: [Color] = [
    Color(red: 0.31, green: 0.65, blue: 0.33), Color(red: 0.22, green: 0.50, blue: 0.90), Color(red: 0.55, green: 0.36, blue: 0.87),
    Color(red: 0.16, green: 0.60, blue: 0.62), Color(red: 0.89, green: 0.27, blue: 0.47),
  ]
}

/// One idea to press: a tilted tile with a symbol, and what it is called.
private struct IdeaCard: View {
  let title: String
  let symbol: String
  /// Nil for the card that surprises, which wears the brand's own orange.
  let color: Color?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: symbol)
          .font(.body.weight(.bold))
          .foregroundStyle(.white)
          .frame(width: 40, height: 40)
          .background(color.map { AnyShapeStyle($0.gradient) } ?? AnyShapeStyle(.brandGradient), in: .rect(cornerRadius: 12, style: .continuous))
          .rotationEffect(.degrees(-7))
        Text(title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)
          .lineLimit(2)
          .multilineTextAlignment(.leading)
        Spacer(minLength: 0)
      }
      .padding(12)
      .frame(maxWidth: .infinity, minHeight: 64)
      .background(Color(.card), in: .rect(cornerRadius: 18, style: .continuous))
    }
    .buttonStyle(.pop)
    .accessibilityHint("Fyller i ett förslag i textrutan")
  }
}
