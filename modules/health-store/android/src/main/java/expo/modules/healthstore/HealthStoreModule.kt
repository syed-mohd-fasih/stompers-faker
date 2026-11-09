package expo.modules.healthstore

import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/**
 * Steps in the platform health store — Android implementation (Health Connect).
 * The iOS implementation (HealthKit, Swift) exposes the exact same functions and shapes,
 * so the JS side (modules/health-store/index.ts) doesn't care which platform it runs on.
 *
 * Times cross the bridge as epoch milliseconds (Double).
 */
class HealthStoreModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val stepsPermissions = setOf(
    HealthPermission.getReadPermission(StepsRecord::class),
    HealthPermission.getWritePermission(StepsRecord::class),
  )

  private var permissionLauncher: AppContextActivityResultLauncher<HashSet<String>, Set<String>>? = null

  override fun definition() = ModuleDefinition {
    Name("HealthStore")

    // Health Connect's permission screen is an Activity-for-result; Expo wires the contract.
    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(PermissionContract())
    }

    /** 'available' | 'unavailable' | 'update_required' */
    Function("getStatus") {
      when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
        else -> "unavailable"
      }
    }

    AsyncFunction("getPermissions") Coroutine { ->
      toPermissionMap(client().permissionController.getGrantedPermissions())
    }

    AsyncFunction("requestPermissions") Coroutine { ->
      val launcher = permissionLauncher ?: throw HealthStoreException("Permission launcher not ready")
      // The dialog only shows what's missing; afterwards re-read what is actually granted.
      withContext(Dispatchers.Main) { launcher.launch(HashSet(stepsPermissions)) }
      toPermissionMap(client().permissionController.getGrantedPermissions())
    }

    /** Inserts step records; returns their Health Connect ids in the same order. */
    AsyncFunction("insertSteps") Coroutine { inputs: List<StepInput> ->
      val zone = ZoneId.systemDefault().rules
      val records = inputs.map { r ->
        val s = Instant.ofEpochMilli(r.start.toLong())
        val e = Instant.ofEpochMilli(r.end.toLong())
        StepsRecord(
          startTime = s,
          startZoneOffset = zone.getOffset(s),
          endTime = e,
          endZoneOffset = zone.getOffset(e),
          count = r.count.toLong(),
          metadata = Metadata.unknownRecordingMethod(r.clientId, 0L, Device(type = Device.TYPE_UNKNOWN)),
        )
      }
      client().insertRecords(records).recordIdsList
    }

    /** This app's own step records touching [start, end]. */
    AsyncFunction("readOwnSteps") Coroutine { start: Double, end: Double ->
      val out = mutableListOf<Map<String, Any?>>()
      var token: String? = null
      do {
        val res = client().readRecords(
          ReadRecordsRequest(
            recordType = StepsRecord::class,
            timeRangeFilter = range(start, end),
            dataOriginFilter = setOf(DataOrigin(context.packageName)),
            ascendingOrder = true,
            pageSize = 1000,
            pageToken = token,
          )
        )
        res.records.forEach { r ->
          out += mapOf(
            "id" to r.metadata.id,
            "start" to r.startTime.toEpochMilli().toDouble(),
            "end" to r.endTime.toEpochMilli().toDouble(),
            "count" to r.count.toDouble(),
            "clientId" to (r.metadata.clientRecordId ?: ""),
          )
        }
        // Some Health Connect versions return "" instead of null on the last page.
        token = res.pageToken?.takeIf { it.isNotEmpty() }
      } while (token != null)
      out
    }

    AsyncFunction("deleteSteps") Coroutine { ids: List<String> ->
      if (ids.isNotEmpty()) {
        client().deleteRecords(StepsRecord::class, recordIdsList = ids, clientRecordIdsList = emptyList())
      }
    }

    /** Total steps from all sources, deduplicated by Health Connect. */
    AsyncFunction("totalSteps") Coroutine { start: Double, end: Double ->
      val res = client().aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), range(start, end)))
      (res[StepsRecord.COUNT_TOTAL] ?: 0L).toDouble()
    }

    /** Hourly buckets: total (all sources, deduplicated) and own (this app only). */
    AsyncFunction("hourlySteps") Coroutine { start: Double, end: Double ->
      val c = client()
      suspend fun buckets(origins: Set<DataOrigin>) = c.aggregateGroupByDuration(
        AggregateGroupByDurationRequest(
          metrics = setOf(StepsRecord.COUNT_TOTAL),
          timeRangeFilter = range(start, end),
          timeRangeSlicer = Duration.ofHours(1),
          dataOriginFilter = origins,
        )
      ).associate { it.startTime.toEpochMilli() to (it.result[StepsRecord.COUNT_TOTAL] ?: 0L) }

      val total = buckets(emptySet())
      val own = buckets(setOf(DataOrigin(context.packageName)))
      (total.keys + own.keys).sorted().map { t ->
        mapOf("start" to t.toDouble(), "total" to (total[t] ?: 0L).toDouble(), "own" to (own[t] ?: 0L).toDouble())
      }
    }

    Function("openHealthSettings") {
      val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  // ---- helpers ------------------------------------------------------------------------

  private fun client(): HealthConnectClient {
    val status = HealthConnectClient.getSdkStatus(context)
    if (status != HealthConnectClient.SDK_AVAILABLE) throw HealthStoreException("Health Connect not available (status $status)")
    return HealthConnectClient.getOrCreate(context)
  }

  private fun range(start: Double, end: Double) =
    TimeRangeFilter.between(Instant.ofEpochMilli(start.toLong()), Instant.ofEpochMilli(end.toLong()))

  private fun toPermissionMap(granted: Set<String>) = mapOf(
    "read" to (HealthPermission.getReadPermission(StepsRecord::class) in granted),
    "write" to (HealthPermission.getWritePermission(StepsRecord::class) in granted),
  )
}

/** One record to insert (JS: { start, end, count, clientId }). */
class StepInput : Record {
  @Field val start: Double = 0.0
  @Field val end: Double = 0.0
  @Field val count: Double = 0.0
  @Field val clientId: String = ""
}

/** Wraps Health Connect's permission contract in Expo's Activity-result contract type. */
private class PermissionContract : AppContextActivityResultContract<HashSet<String>, Set<String>> {
  private val hc = PermissionController.createRequestPermissionResultContract()
  override fun createIntent(context: Context, input: HashSet<String>): Intent = hc.createIntent(context, input)
  override fun parseResult(input: HashSet<String>, resultCode: Int, intent: Intent?): Set<String> =
    hc.parseResult(resultCode, intent)
}

private class HealthStoreException(message: String) : CodedException(message)
