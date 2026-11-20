// The app's source files, to read. Changes are made by asking in the chat.
import SwiftUI

struct CodeView: View {
  let store: ProjectStore
  let api: API

  @State private var files: [String: String] = [:]
  @State private var hasLoaded = false
  @State private var errorText: String?

  private var paths: [String] { files.keys.sorted() }

  var body: some View {
    Group {
      if let errorText {
        ContentUnavailableView(errorText, systemImage: "wifi.exclamationmark")
      } else if !hasLoaded {
        ProgressView()
      } else if files.isEmpty {
        MascotNote(title: Text("Inga filer än"))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        List(paths, id: \.self) { path in
          NavigationLink(value: SourceFile(path: path, content: files[path] ?? "")) {
            VStack(alignment: .leading, spacing: 2) {
              Text(path.split(separator: "/").last.map(String.init) ?? path)
              Text(path).font(.caption).foregroundStyle(.secondary)
            }
          }
          .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
      }
    }
    // Read again when the agent has finished changing things.
    .task(id: store.isRunning) {
      guard !store.isRunning else { return }
      await load()
    }
  }

  private func load() async {
    do throws(APIError) {
      files = try await api.files(store.id)
      errorText = nil
    } catch {
      if !hasLoaded { errorText = Texts.apiError(error.code) }
    }
    hasLoaded = true
  }
}

struct SourceFile: Hashable {
  let path: String
  let content: String
}

struct SourceFileView: View {
  let file: SourceFile

  var body: some View {
    ScrollView([.vertical, .horizontal]) {
      Text(file.content)
        .font(.system(.footnote, design: .monospaced))
        .textSelection(.enabled)
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle(file.path.split(separator: "/").last.map(String.init) ?? file.path)
    .navigationBarTitleDisplayMode(.inline)
  }
}
