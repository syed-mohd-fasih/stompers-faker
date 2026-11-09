import ExpoModulesCore
import HealthKit
import UIKit

// Steps in the platform health store — iOS implementation (HealthKit).
// Mirrors android/…/HealthStoreModule.kt: same function names, arguments and result
// shapes, so modules/health-store/index.ts is identical on both platforms.
// Times cross the bridge as epoch milliseconds (Double).

/// HealthKit stores are thread-safe (HKHealthStore is Sendable); one shared instance.
private let store = HKHealthStore()
private let stepType = HKQuantityType(.stepCount)
/// Our own id per record ("fake-<start>-<end>"). A custom key rather than
/// HKMetadataKeySyncIdentifier, which would make HealthKit replace/ignore duplicates.
private let clientIdKey = "StompersClientId"

private func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
private func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }

/// Samples overlapping [start, end] (same semantics as Health Connect's `between`).
private func range(_ start: Double, _ end: Double) -> NSPredicate {
  HKQuery.predicateForSamples(withStart: date(start), end: date(end), options: [])
}

/// One record to insert (JS: { start, end, count, clientId }).
struct StepInput: Record {
  @Field var start: Double = 0
  @Field var end: Double = 0
  @Field var count: Double = 0
  @Field var clientId: String = ""
}

public class HealthStoreModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HealthStore")

    /// HealthKit is "unavailable" only on devices without it (e.g. some iPads).
    Function("getStatus") { () -> String in
      HKHealthStore.isHealthDataAvailable() ? "available" : "unavailable"
    }

    /// iOS never reveals read access (privacy), so read is always "unknown".
    AsyncFunction("getPermissions") { () async throws -> [String: Any] in
      permissionMap()
    }

    AsyncFunction("requestPermissions") { () async throws -> [String: Any] in
      try await store.requestAuthorization(toShare: [stepType], read: [stepType])
      return permissionMap()
    }

    /// Saves step samples; returns their UUIDs in the same order.
    AsyncFunction("insertSteps") { (inputs: [StepInput]) async throws -> [String] in
      let samples = inputs.map { r in
        HKQuantitySample(
          type: stepType,
          quantity: HKQuantity(unit: .count(), doubleValue: r.count.rounded()),
          start: date(r.start),
          end: date(r.end),
          metadata: [clientIdKey: r.clientId]
        )
      }
      try await store.save(samples)
      return samples.map { $0.uuid.uuidString }
    }

    /// This app's own step samples touching [start, end].
    AsyncFunction("readOwnSteps") { (start: Double, end: Double) async throws -> [[String: Any]] in
      let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
        range(start, end),
        HKQuery.predicateForObjects(from: HKSource.default()),
      ])
      let descriptor = HKSampleQueryDescriptor(
        predicates: [.quantitySample(type: stepType, predicate: predicate)],
        sortDescriptors: [SortDescriptor(\.startDate, order: .forward)]
      )
      let samples = try await descriptor.result(for: store)
      return samples.map { s in
        [
          "id": s.uuid.uuidString,
          "start": ms(s.startDate),
          "end": ms(s.endDate),
          "count": s.quantity.doubleValue(for: .count()),
          "clientId": (s.metadata?[clientIdKey] as? String) ?? "",
        ]
      }
    }

    /// Deletes samples by UUID. HealthKit only lets an app delete what it wrote itself.
    AsyncFunction("deleteSteps") { (ids: [String]) async throws in
      let uuids = Set(ids.compactMap { UUID(uuidString: $0) })
      if uuids.isEmpty { return }
      try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
        store.deleteObjects(of: stepType, predicate: HKQuery.predicateForObjects(with: uuids)) { _, _, error in
          if let error { cont.resume(throwing: error) } else { cont.resume() }
        }
      }
    }

    /// Total steps from all sources, deduplicated by HealthKit (source priority).
    AsyncFunction("totalSteps") { (start: Double, end: Double) async throws -> Double in
      try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Double, Error>) in
        let query = HKStatisticsQuery(quantityType: stepType, quantitySamplePredicate: range(start, end), options: .cumulativeSum) { _, stats, error in
          if let error, (error as? HKError)?.code != .errorNoData {
            cont.resume(throwing: error)
          } else {
            cont.resume(returning: stats?.sumQuantity()?.doubleValue(for: .count()) ?? 0)
          }
        }
        store.execute(query)
      }
    }

    /// Hourly buckets: total (all sources, deduplicated) and own (this app only).
    AsyncFunction("hourlySteps") { (start: Double, end: Double) async throws -> [[String: Any]] in
      let from = date(start)
      let to = date(end)
      return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<[[String: Any]], Error>) in
        let query = HKStatisticsCollectionQuery(
          quantityType: stepType,
          quantitySamplePredicate: range(start, end),
          options: [.cumulativeSum, .separateBySource],
          anchorDate: Calendar.current.startOfDay(for: from),
          intervalComponents: DateComponents(hour: 1)
        )
        query.initialResultsHandler = { _, results, error in
          if let error, (error as? HKError)?.code != .errorNoData {
            cont.resume(throwing: error)
            return
          }
          var out: [[String: Any]] = []
          results?.enumerateStatistics(from: from, to: to) { stats, _ in
            out.append([
              "start": ms(stats.startDate),
              "total": stats.sumQuantity()?.doubleValue(for: .count()) ?? 0,
              "own": stats.sumQuantity(for: HKSource.default())?.doubleValue(for: .count()) ?? 0,
            ])
          }
          cont.resume(returning: out)
        }
        store.execute(query)
      }
    }

    /// Opens the Health app (permissions live under Sharing → Apps there).
    /// Sync like on Android; UIKit work is hopped onto the main actor.
    Function("openHealthSettings") {
      Task { @MainActor in
        if let url = URL(string: "x-apple-health://") {
          _ = await UIApplication.shared.open(url)
        }
      }
    }
  }
}

private func permissionMap() -> [String: Any] {
  ["read": "unknown", "write": store.authorizationStatus(for: stepType) == .sharingAuthorized]
}
