// The person's plan: what it holds, how much of it is used, and a way to ask for a larger one.
// For someone whose plan lets them build nothing this is the paywall: what they get, what it
// costs, and a field for a code that lets them past it.
// Where credits are counted, it shows how many are left and what the latest messages cost.
// There is no payment yet: asking sends a request, and the people who run the service answer it.
import SwiftUI

struct PlanView: View {
  let api: API
  /// Called when a code has let the person past the paywall, after the view has closed.
  var onUnlock: (() -> Void)?

  @Environment(\.dismiss) private var dismiss
  @State private var plan: PlanState?
  @State private var isBusy = false
  @State private var errorText: String?
  @State private var code = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          if let plan {
            if !plan.enforced {
              Text("Just nu är allt öppet för alla. Planerna börjar gälla senare.")
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color.brand.opacity(0.14), in: .rect(cornerRadius: 16, style: .continuous))
            }
            if plan.isLocked {
              pitch
            } else if let credits = plan.credits {
              creditsCard(credits, in: plan)
            } else {
              used(plan)
            }
            ForEach(PlanState.order, id: \.self) { id in
              // A plan that holds nothing is the paywall itself, not something to choose.
              if let limits = plan.plans[id], limits.apps > 0 { card(id, limits, in: plan) }
            }
            if plan.takesCode == true, plan.plan != PlanState.order.last { codeCard }
            Text("Betalning är inte påslagen än. När du ber om en plan slår vi på den åt dig.")
              .font(.footnote)
              .foregroundStyle(.secondary)
              .frame(maxWidth: .infinity, alignment: .leading)
          } else if errorText == nil {
            Mascot(isDancing: true)
              .frame(width: 120)
              .padding(.top, 60)
          }
          if let errorText {
            Text(errorText)
              .font(.footnote)
              .foregroundStyle(.red)
          }
        }
        .padding()
      }
      .background(Color(.paper))
      .navigationTitle(plan?.isLocked == true ? "Lås upp App Dance" : "Min plan")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
      }
      .task { await load() }
    }
  }

  /// What stands in front of the paywall: what the person gets on the other side of it.
  private var pitch: some View {
    VStack(spacing: 12) {
      Mascot(tile: .white, eyes: .brandDeep, isWaving: true)
        .frame(width: 96)
      Text("Din idé är ett steg från att bli en app")
        .font(.title2.weight(.heavy))
        .multilineTextAlignment(.center)
      Text("Välj en plan, så bygger vi den åt dig medan du tittar på. Du provar den direkt i telefonen.")
        .font(.subheadline)
        .multilineTextAlignment(.center)
        .opacity(0.9)
    }
    .foregroundStyle(.white)
    .frame(maxWidth: .infinity)
    .padding(22)
    .background(.brandGradient, in: .rect(cornerRadius: 26, style: .continuous))
  }

  /// A code in place of paying.
  private var codeCard: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Har du en kod?")
        .font(.headline)
      HStack(spacing: 10) {
        TextField("Skriv koden här", text: $code)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.go)
          .onSubmit(unlock)
          .padding(.horizontal, 14)
          .padding(.vertical, 11)
          .background(Color(.paper), in: .rect(cornerRadius: 14, style: .continuous))
        Button("Lås upp", action: unlock)
          .font(.subheadline.weight(.semibold))
          .padding(.horizontal, 16)
          .frame(minHeight: 44)
          .foregroundStyle(.white)
          .background(.brandGradient, in: .capsule)
          .buttonStyle(.pop)
          .disabled(isBusy || code.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card()
  }

  private func used(_ plan: PlanState) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      meter(String(localized: "Meddelanden den här månaden"), plan.used.messages, of: plan.limits.messages)
      meter(String(localized: "Appar"), plan.used.apps, of: plan.limits.apps)
      Text("Meddelandena räknas om från \(plan.resets.formatted(.dateTime.day().month(.wide))).")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card()
  }

  /// How many credits are left, when some of them run out, and what the latest messages cost.
  private func creditsCard(_ credits: CreditState, in plan: PlanState) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        Text("Credits kvar")
          .font(.subheadline)
        Spacer()
        Text(credits.balance, format: .number)
          .font(.largeTitle.weight(.heavy))
          .monospacedDigit()
          .contentTransition(.numericText())
      }
      .padding(14)
      .background(Color.brand.opacity(0.14), in: .rect(cornerRadius: 16, style: .continuous))
      .accessibilityElement(children: .combine)
      if let expiring = credits.expiring, expiring.amount > 0 {
        Text("\(expiring.amount) av dem går ut \(Date(timeIntervalSince1970: expiring.at / 1000).formatted(.dateTime.day().month(.wide))).")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      meter(String(localized: "Appar"), plan.used.apps, of: plan.limits.apps)
      Text("Ett meddelande kostar det som arbetet bakom det kostar: en liten ändring brukar ta några få credits och en ny app fler. Inget meddelande kostar mer än \(Texts.credits(credits.maxPerMessage)).")
        .font(.footnote)
        .foregroundStyle(.secondary)
      if !credits.recent.isEmpty {
        DisclosureGroup("Det senaste") {
          VStack(spacing: 8) {
            ForEach(credits.recent) { spend in
              HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(spend.what == "listing" ? String(localized: "App Store-texter") : String(localized: "Meddelande"))
                  Text([spend.app, spend.date.formatted(.dateTime.day().month(.abbreviated))].compactMap(\.self).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                Text(Texts.credits(spend.credits))
                  .fontWeight(.semibold)
                  .monospacedDigit()
              }
              .font(.subheadline)
              .accessibilityElement(children: .combine)
            }
          }
          .padding(.top, 8)
        }
        .font(.subheadline.weight(.semibold))
        .tint(.primary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card()
  }

  private func meter(_ label: String, _ used: Int, of limit: Int) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(label)
        Spacer()
        Text("\(used) av \(limit)").fontWeight(.semibold).monospacedDigit()
      }
      .font(.subheadline)
      ProgressView(value: Double(min(used, limit)), total: Double(max(limit, 1)))
        .tint(.brand)
    }
    .accessibilityElement(children: .combine)
  }

  private func card(_ id: String, _ limits: PlanLimits, in plan: PlanState) -> some View {
    let isMine = id == plan.plan
    return VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(Texts.planName(id))
          .font(.title3.weight(.heavy))
        if let price = plan.prices?[id] {
          Spacer()
          Text(price)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.brand)
        }
        if isMine {
          Text("Din plan")
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(.brandGradient, in: .capsule)
        }
      }
      ForEach(Texts.planLines(limits, credits: plan.credits != nil), id: \.self) { line in
        Label(line, systemImage: "checkmark.circle.fill")
          .font(.subheadline)
          .symbolRenderingMode(.hierarchical)
          .foregroundStyle(.primary)
      }
      if plan.isLarger(id) {
        if plan.requested == id {
          Text("Du har bett om den här planen. Vi slår på den åt dig och hör av oss.")
            .font(.footnote.weight(.medium))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.brand.opacity(0.14), in: .rect(cornerRadius: 14, style: .continuous))
        } else {
          Button("Jag vill ha \(Texts.planName(id))") { ask(id) }
            .buttonStyle(.bouncy)
            .disabled(isBusy)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card()
    .overlay {
      if isMine {
        RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.brand, lineWidth: 2)
      }
    }
  }

  private func load() async {
    do throws(APIError) {
      plan = try await api.plan()
    } catch {
      errorText = Texts.apiError(error.code)
    }
  }

  private func unlock() {
    let given = code.trimmingCharacters(in: .whitespaces)
    guard !given.isEmpty, !isBusy else { return }
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        let wasLocked = plan?.isLocked == true
        plan = try await api.unlockPlan(code: given)
        code = ""
        // Past the paywall: back to what the person was about to do.
        if wasLocked, plan?.isLocked != true {
          dismiss()
          onUnlock?()
        }
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }

  private func ask(_ id: String) {
    isBusy = true
    errorText = nil
    Task {
      defer { isBusy = false }
      do throws(APIError) {
        plan = try await api.requestPlan(id)
      } catch {
        errorText = Texts.apiError(error.code)
      }
    }
  }
}
