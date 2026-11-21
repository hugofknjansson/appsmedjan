// The person's plan: what it holds, how much of it is used, and a way to ask for a larger one.
// There is no payment yet: asking sends a request, and the people who run the service answer it.
import SwiftUI

struct PlanView: View {
  let api: API

  @Environment(\.dismiss) private var dismiss
  @State private var plan: PlanState?
  @State private var isBusy = false
  @State private var errorText: String?

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
            used(plan)
            ForEach(PlanState.order, id: \.self) { id in
              if let limits = plan.plans[id] { card(id, limits, in: plan) }
            }
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
      .navigationTitle("Min plan")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Stäng") { dismiss() }
        }
      }
      .task { await load() }
    }
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
        if isMine {
          Text("Din plan")
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(.brandGradient, in: .capsule)
        }
      }
      ForEach(Texts.planLines(limits), id: \.self) { line in
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
