// The App Store guide's state: what the server holds, and the person's edits on top of it.
import Foundation
import Observation
import UIKit

@Observable
final class StoreModel {
  enum Activity: Equatable { case idle, loading, saving, drafting, capturing, icon, sending, submitting }

  let projectID: String
  let api: API

  /// The server's view. Nil until the first answer.
  private(set) var state: StoreState?
  var listing = StoreListing()
  var choices = StoreChoices()
  var pages = StorePages()
  var contact = ReviewContact()
  /// What the latest suggestion found that would raise the age rating; nil before any suggestion.
  private(set) var ageNotes: [String]?
  private(set) var activity = Activity.loading
  private(set) var errorText: String?
  /// Changes each time the icon does, so the picture is fetched again.
  private(set) var iconVersion = 0

  init(projectID: String, api: API) {
    self.projectID = projectID
    self.api = api
  }

  var isBusy: Bool { activity != .idle }
  var isSyncing: Bool { state?.sync.status == .working }
  var isSubmitting: Bool { state?.submit.status == .working }

  /// True when the form differs from what the server has saved.
  var isDirty: Bool {
    guard let state else { return false }
    return listing != state.listing || choices != state.choices || pages != state.pages || contact != state.contact
  }

  /// The addresses of the pages the service shows for the app.
  func hostedURL(_ page: String) -> String {
    api.baseURL.appending(path: "a/\(projectID)/\(page)").absoluteString
  }

  func load() async {
    await perform(.loading) { () throws(APIError) in
      let fresh = try await api.store(projectID)
      adopt(fresh, keepingEdits: false)
      // Most people have no website for the two pages, so ours are the starting choice.
      if !fresh.pages.hosted && fresh.listing.supportUrl.isEmpty && fresh.listing.privacyUrl.isEmpty { hostPages(true) }
    }
  }

  /// Asks the server how a running send or submit is going, until it is done.
  func follow() async {
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(1.5))
      guard isSyncing || isSubmitting, activity == .idle else { continue }
      if let fresh = try? await api.store(projectID) { adopt(fresh, keepingEdits: true) }
    }
  }

  /// Switches between pages shown by the service and the person's own; the two links follow along.
  func hostPages(_ hosted: Bool) {
    pages.hosted = hosted
    pages.lang = Locale.current.language.languageCode?.identifier == "sv" ? "sv" : "en"
    if hosted {
      if pages.supportEmail.isEmpty { pages.supportEmail = contact.email }
      listing.supportUrl = hostedURL("support")
      listing.privacyUrl = hostedURL("privacy")
    } else {
      if listing.supportUrl == hostedURL("support") { listing.supportUrl = "" }
      if listing.privacyUrl == hostedURL("privacy") { listing.privacyUrl = "" }
    }
  }

  @discardableResult
  func save() async -> Bool {
    await perform(.saving) { () throws(APIError) in
      adopt(try await api.saveStore(projectID, listing: listing, choices: choices, contact: contact, pages: pages), keepingEdits: false)
    }
  }

  func draft() async {
    await perform(.drafting) { () throws(APIError) in
      let suggestion = try await api.draftStore(projectID)
      listing.name = suggestion.draft.name ?? listing.name
      listing.subtitle = suggestion.draft.subtitle ?? listing.subtitle
      listing.promo = suggestion.draft.promo ?? listing.promo
      listing.description = suggestion.draft.description ?? listing.description
      listing.keywords = suggestion.draft.keywords ?? listing.keywords
      listing.category = suggestion.draft.category ?? listing.category
      pages.privacyText = suggestion.privacyPolicy
      ageNotes = suggestion.ageRatingNotes
    }
  }

  func deleteScreenshot(_ shot: String) async {
    await perform(.capturing) { () throws(APIError) in
      adopt(try await api.deleteScreenshot(projectID, shot: shot), keepingEdits: true)
    }
  }

  /// Any picture becomes the square, opaque 1024 px PNG that Apple asks for.
  func setIcon(from data: Data) async {
    guard let image = UIImage(data: data) else {
      errorText = Texts.apiError("icon_not_png")
      return
    }
    let side: CGFloat = 1024
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let png = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).pngData { context in
      UIColor.white.setFill()
      context.fill(CGRect(x: 0, y: 0, width: side, height: side))
      // Fills the square; whatever sticks out on the longer side is cut off evenly.
      let scale = max(side / image.size.width, side / image.size.height)
      let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
      image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
    }
    await perform(.icon) { () throws(APIError) in
      adopt(try await api.uploadIcon(projectID, png: png), keepingEdits: true)
      iconVersion += 1
    }
  }

  func removeIcon() async {
    await perform(.icon) { () throws(APIError) in
      adopt(try await api.deleteIcon(projectID), keepingEdits: true)
      iconVersion += 1
    }
  }

  func send() async {
    if isDirty, !(await save()) { return }
    await perform(.sending) { () throws(APIError) in
      adopt(try await api.syncStore(projectID), keepingEdits: true)
    }
  }

  func submit() async {
    await perform(.submitting) { () throws(APIError) in
      adopt(try await api.submitStore(projectID), keepingEdits: true)
    }
  }

  /// Takes the server's answer. The person's unsaved edits survive answers to things other than saving.
  private func adopt(_ fresh: StoreState, keepingEdits: Bool) {
    let dirty = keepingEdits && isDirty
    state = fresh
    if !dirty {
      listing = fresh.listing
      choices = fresh.choices
      pages = fresh.pages
      contact = fresh.contact
    }
  }

  @discardableResult
  private func perform(_ kind: Activity, _ work: () async throws(APIError) -> Void) async -> Bool {
    activity = kind
    errorText = nil
    defer { activity = .idle }
    do throws(APIError) {
      try await work()
      return true
    } catch {
      errorText = Texts.apiError(error.code)
      return false
    }
  }
}
