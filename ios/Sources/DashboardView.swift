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

  private var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section {
          promptCard
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        } footer: {
          if let errorText {
            Text(errorText).foregroundStyle(.red)
          } else if let notice {
            Text(notice)
          }
        }

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

        Section("Dina appar") {
          if hasLoaded && projects.isEmpty {
            MascotNote(title: Text("Du har inga appar än"), message: Text("Beskriv din första idé här ovanför, så dansar vi igång."))
              .frame(maxWidth: .infinity)
              .listRowBackground(Color.clear)
          }
          ForEach(projects) { project in
            NavigationLink(value: project) {
              HStack(spacing: 14) {
                AppTile(name: project.name, seed: project.id)
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
      .paperBackground()
      .navigationTitle("App Dance")
      .navigationDestination(for: ProjectSummary.self) { project in
        ProjectView(project: project, api: model.api)
      }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Text(user.email)
            Button("Apple-utvecklarkonto", systemImage: "person.badge.key") { isShowingAccount = true }
            Button("Logga ut", role: .destructive) {
              Task { await model.logOut() }
            }
          } label: {
            Label("Konto", systemImage: "person.crop.circle")
          }
        }
      }
      .sheet(isPresented: $isShowingAccount) {
        AppleAccountView(api: model.api)
      }
      .refreshable { await load() }
      .task { await load() }
      // Names change while the agent works, so the list is read again when coming back to it.
      .onChange(of: path) { _, new in
        if new.isEmpty { Task { await load() } }
      }
    }
  }

  private var promptCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("Vad vill du bygga?")
          .font(.title2.weight(.heavy))
          .foregroundStyle(.white)
        Spacer()
        Mascot(tile: .white, eyes: .brandDeep, isDancing: isCreating)
          .frame(width: 84)
      }
      TextField("Till exempel: en app där jag kan hålla koll på mina växter", text: $prompt, axis: .vertical)
        .lineLimit(3...8)
        .fieldBox()
      ScrollView(.horizontal) {
        HStack(spacing: 8) {
          ForEach(Idea.all) { idea in
            Button {
              prompt = idea.prompt
            } label: {
              HStack(spacing: 6) {
                Image(systemName: idea.symbol)
                Text(idea.title)
              }
              .font(.footnote.weight(.semibold))
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .background(.white.opacity(0.22), in: .capsule)
              .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Fyller i ett förslag i textrutan")
          }
        }
      }
      .scrollIndicators(.hidden)
      Button {
        create()
      } label: {
        if isCreating { ProgressView().tint(.brandDeep) } else { Text("Bygg min app") }
      }
      .buttonStyle(.bouncyInverted)
      .disabled(isCreating || trimmedPrompt.isEmpty)
    }
    .padding(18)
    .background(.brandGradient, in: .rect(cornerRadius: 28, style: .continuous))
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
        errorText = Texts.apiError(error.code)
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
  ]
}
