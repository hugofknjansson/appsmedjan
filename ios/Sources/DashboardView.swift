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

  private var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section {
          TextField("Till exempel: en app där jag kan hålla koll på mina växter", text: $prompt, axis: .vertical)
            .lineLimit(3...8)
          Button {
            create()
          } label: {
            if isCreating { ProgressView() } else { Text("Bygg min app") }
          }
          .disabled(isCreating || trimmedPrompt.isEmpty)
        } header: {
          Text("Vad vill du bygga?")
        } footer: {
          if let errorText {
            Text(errorText).foregroundStyle(.red)
          } else if let notice {
            Text(notice)
          }
        }

        Section("Dina appar") {
          if hasLoaded && projects.isEmpty {
            Text("Du har inga appar än. Beskriv din första idé här ovanför.")
              .foregroundStyle(.secondary)
          }
          ForEach(projects) { project in
            NavigationLink(value: project) {
              VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(.headline)
                Text("Ändrad \(project.updated.formatted(date: .abbreviated, time: .omitted))")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
            }
          }
          .onDelete(perform: delete)
        }
      }
      .navigationTitle("Appsmedjan")
      .navigationDestination(for: ProjectSummary.self) { project in
        ProjectView(project: project, api: model.api)
      }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Text(user.email)
            Button("Logga ut", role: .destructive) {
              Task { await model.logOut() }
            }
          } label: {
            Label("Konto", systemImage: "person.crop.circle")
          }
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

  private func load() async {
    do throws(APIError) {
      projects = try await model.api.projects()
      hasLoaded = true
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
