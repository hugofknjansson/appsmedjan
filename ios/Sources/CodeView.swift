// The app's source, for the people who are shown everything: the files the builder has written, to
// read, copy and take away as an Xcode project. Nothing is changed from here; the builder does that.
import SwiftUI

struct CodeView: View {
  let store: ProjectStore
  let api: API

  @Environment(\.dismiss) private var dismiss
  @State private var code: ProjectCode?
  @State private var errorText: String?
  /// The zipped project, once it has been fetched and is ready to hand on.
  @State private var archive: URL?
  @State private var isFetching = false

  private var paths: [String] { (code?.files.keys).map { $0.sorted() } ?? [] }

  private var lineCount: Int {
    code?.files.values.reduce(0) { $0 + $1.split(separator: "\n", omittingEmptySubsequences: false).count } ?? 0
  }

  var body: some View {
    NavigationStack {
      Group {
        if let code {
          List {
            Section {
              LabeledContent("Bundle-ID") {
                Text(code.bundleId ?? "")
                  .font(.footnote.monospaced())
                  .textSelection(.enabled)
              }
              if let build = store.publish.build {
                LabeledContent("Senaste uppladdning") {
                  Text(build)
                    .font(.footnote.monospaced())
                    .textSelection(.enabled)
                }
              }
              LabeledContent("Filer", value: String(localized: "\(paths.count) filer · \(lineCount) rader"))
            } footer: {
              Text("Appen är skriven i Swift med SwiftUI. Byggaren skriver om filerna när du ber om ändringar.")
            }

            Section {
              ForEach(paths, id: \.self) { path in
                NavigationLink(value: path) {
                  Label(Self.short(path), systemImage: "swift")
                    .font(.subheadline.monospaced())
                }
              }
            }

            Section {
              if let archive {
                ShareLink(item: archive) {
                  Label("Dela Xcode-projektet", systemImage: "square.and.arrow.up")
                }
              } else if isFetching {
                WaitCard(title: String(localized: "Packar ihop projektet"), lines: [String(localized: "Viker ihop filerna"), String(localized: "Knyter ett snöre om")])
              } else {
                Button("Hämta som Xcode-projekt", systemImage: "arrow.down.circle") { fetchArchive() }
              }
              if let errorText {
                Text(errorText)
                  .font(.footnote)
                  .foregroundStyle(.red)
              }
            }
          }
          .navigationDestination(for: String.self) { path in
            CodeFile(path: path, content: code.files[path] ?? "")
          }
        } else if let errorText {
          MascotNote(title: Text(errorText))
        } else {
          Waiting()
        }
      }
      .navigationTitle("Kod")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
      }
    }
    // Read again whenever the builder has finished: the files are then what was just built.
    .task(id: store.isRunning) {
      do throws(APIError) {
        code = try await api.code(store.id)
        archive = nil
        errorText = nil
      } catch {
        if code == nil { errorText = Texts.apiError(error.code) }
      }
    }
  }

  static func short(_ path: String) -> String {
    path.hasPrefix("Sources/") ? String(path.dropFirst("Sources/".count)) : path
  }

  private func fetchArchive() {
    isFetching = true
    errorText = nil
    Task {
      defer { isFetching = false }
      do throws(APIError) {
        let data = try await api.sourceZip(store.id)
        let name = store.name.filter { $0.isLetter || $0.isNumber || $0 == " " || $0 == "-" }
        let file = FileManager.default.temporaryDirectory.appending(path: "\(name.isEmpty ? "App" : name).zip")
        do {
          try data.write(to: file, options: .atomic)
          archive = file
        } catch {
          errorText = Texts.apiError("internal")
        }
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}

/// One file: its text, as it is, to read and copy.
private struct CodeFile: View {
  let path: String
  let content: String

  @State private var copies = 0

  var body: some View {
    // A short file starts at the top left like a long one does: scrolling both ways would centre it.
    GeometryReader { area in
      ScrollView([.vertical, .horizontal]) {
        Text(content)
          .font(.caption.monospaced())
          .textSelection(.enabled)
          .padding()
          .frame(minWidth: area.size.width, minHeight: area.size.height, alignment: .topLeading)
      }
    }
    .background(Color(.paper))
    .navigationTitle(CodeView.short(path))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button(copies > 0 ? String(localized: "Kopierat") : String(localized: "Kopiera"), systemImage: copies > 0 ? "checkmark" : "doc.on.doc") {
          UIPasteboard.general.string = content
          copies += 1
        }
        .labelStyle(.titleAndIcon)
        .contentTransition(.symbolEffect(.replace))
      }
    }
    .sensoryFeedback(.success, trigger: copies)
  }
}
