package expo.modules.stepsync

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * All the real-step sync logic. Used by both the WorkManager job and the JS module.
 *
 * State lives in SharedPreferences so it survives the app being killed:
 *   enabled        – sync toggle
 *   lastValue      – step counter value at the last reading (cumulative since boot)
 *   lastBoot       – Settings.Global.BOOT_COUNT at the last reading (detects reboots)
 *   lastTime       – wall-clock ms of the last reading; next record starts here
 *   lastSyncTime / lastDelta / lastError / lastMessage – status for the UI
 *   blockedRanges  – fake-record time ranges mirrored from JS ("s,e;s,e;...")
 */
object StepSync {
  private const val PREFS = "step_sync"
  private const val WORK_NAME = "step-sync"
  private const val SENSOR_TIMEOUT_MS = 10_000L
  private const val MIN_SLICE_MS = 60_000L // don't write slivers shorter than 1 min
  const val REAL_PREFIX = "real-" // must match REAL_PREFIX in src/lib/health.ts

  private val mutex = Mutex() // the worker and "Sync now" must not run at the same time

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---- enable / disable -------------------------------------------------------

  fun enable(ctx: Context) {
    // Clear the baseline so the first run only records a starting point, instead of
    // dumping every step taken while sync was off.
    prefs(ctx).edit {
      putBoolean("enabled", true)
      remove("lastValue"); remove("lastBoot"); remove("lastTime")
    }
    val request = PeriodicWorkRequestBuilder<StepSyncWorker>(15, TimeUnit.MINUTES).build()
    // UPDATE: re-enabling never creates a duplicate job. (JS calls syncNow() right
    // after enabling so the baseline is stored immediately.)
    WorkManager.getInstance(ctx)
      .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
  }

  fun disable(ctx: Context) {
    prefs(ctx).edit { putBoolean("enabled", false) }
    WorkManager.getInstance(ctx).cancelUniqueWork(WORK_NAME)
  }

  fun status(ctx: Context): Map<String, Any?> {
    val p = prefs(ctx)
    fun long(key: String): Double? = if (p.contains(key)) p.getLong(key, 0).toDouble() else null
    return mapOf(
      "enabled" to p.getBoolean("enabled", false),
      "lastSyncTime" to long("lastSyncTime"),
      "lastRunTime" to long("lastRunTime"),
      "lastDelta" to long("lastDelta"),
      "lastError" to p.getString("lastError", null),
      "lastMessage" to p.getString("lastMessage", null),
      "baselineSet" to p.contains("lastValue"),
      "sensorAvailable" to (sensorManager(ctx).getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null),
      "hasActivityPermission" to hasActivityPermission(ctx),
    )
  }

  /** JS sends this app's fake record ranges as [s1, e1, s2, e2, ...] (epoch ms). */
  fun setBlockedRanges(ctx: Context, flat: List<Double>) {
    val text = flat.chunked(2).filter { it.size == 2 }
      .joinToString(";") { "${it[0].toLong()},${it[1].toLong()}" }
    prefs(ctx).edit { putString("blockedRanges", text) }
  }

  // ---- the sync itself --------------------------------------------------------

  /** Reads the counter, writes the delta to Health Connect. Returns a status message. */
  suspend fun sync(ctx: Context): String = mutex.withLock {
    val p = prefs(ctx)
    val now = System.currentTimeMillis()
    p.edit { putLong("lastRunTime", now) }
    try {
      val message = doSync(ctx, now)
      p.edit { putString("lastMessage", message); remove("lastError") }
      message
    } catch (e: Exception) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      p.edit { putString("lastError", msg) }
      throw e
    }
  }

  private suspend fun doSync(ctx: Context, now: Long): String {
    val p = prefs(ctx)
    if (!hasActivityPermission(ctx)) error("ACTIVITY_RECOGNITION permission not granted")

    val current = readStepCounter(ctx).toLong()
    val boot = Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT, -1)

    // First run: only remember where the counter is.
    if (!p.contains("lastValue")) {
      saveBaseline(ctx, current, boot, now)
      return "Baseline stored ($current). Nothing written."
    }

    val lastValue = p.getLong("lastValue", 0)
    val lastBoot = p.getInt("lastBoot", -1)
    val lastTime = p.getLong("lastTime", now)

    // The counter resets to 0 on reboot. If it went down (or the boot count changed),
    // everything on the counter now was walked since the reboot.
    val rebooted = current < lastValue || (boot != -1 && lastBoot != -1 && boot != lastBoot)
    val delta = if (rebooted) current else current - lastValue

    if (delta <= 0) {
      saveBaseline(ctx, current, boot, now)
      p.edit { putLong("lastDelta", 0) }
      return "No new steps."
    }
    if (now - lastTime < MIN_SLICE_MS) return "Last reading was under a minute ago; waiting."

    val client = healthConnect(ctx)
    val granted = client.permissionController.getGrantedPermissions()
    if (HealthPermission.getWritePermission(StepsRecord::class) !in granted) {
      error("Health Connect WRITE_STEPS permission not granted")
    }

    // Never overlap our own (fake) records: write only into the free parts of the window.
    val busy = blockedRanges(ctx) + readOwnRanges(client, ctx, lastTime, now)
    val free = freeRanges(lastTime, now, busy).filter { it.second - it.first >= MIN_SLICE_MS }
    if (free.isEmpty()) {
      // Keep the old baseline so these steps are written on a later run.
      return "Window fully covered by other records of this app; $delta steps kept for later."
    }

    val records = split(delta, free).map { (start, end, count) ->
      val s = Instant.ofEpochMilli(start)
      val e = Instant.ofEpochMilli(end)
      val zone = ZoneId.systemDefault().rules
      StepsRecord(
        startTime = s,
        startZoneOffset = zone.getOffset(s),
        endTime = e,
        endZoneOffset = zone.getOffset(e),
        count = count,
        // Honest metadata: automatically recorded by the phone's sensor.
        metadata = Metadata.autoRecorded(Device(type = Device.TYPE_PHONE), "$REAL_PREFIX$start-$end", 0L),
      )
    }
    client.insertRecords(records)

    saveBaseline(ctx, current, boot, now)
    p.edit { putLong("lastSyncTime", now); putLong("lastDelta", delta) }
    return "Wrote $delta steps in ${records.size} record(s)${if (rebooted) " (after reboot)" else ""}."
  }

  private fun saveBaseline(ctx: Context, value: Long, boot: Int, time: Long) {
    prefs(ctx).edit { putLong("lastValue", value); putInt("lastBoot", boot); putLong("lastTime", time) }
  }

  // ---- helpers ----------------------------------------------------------------

  private fun sensorManager(ctx: Context) = ctx.getSystemService(SensorManager::class.java)

  private fun hasActivityPermission(ctx: Context) =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION) ==
      PackageManager.PERMISSION_GRANTED

  /** Registers a listener and returns the first reading (cumulative steps since boot). */
  private suspend fun readStepCounter(ctx: Context): Float {
    val sm = sensorManager(ctx)
    val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
      ?: error("This device has no step counter sensor")
    return withTimeoutOrNull(SENSOR_TIMEOUT_MS) {
      suspendCancellableCoroutine { cont ->
        val listener = object : SensorEventListener {
          override fun onSensorChanged(event: SensorEvent) {
            sm.unregisterListener(this)
            if (cont.isActive) cont.resume(event.values[0])
          }
          override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, Handler(Looper.getMainLooper()))
        cont.invokeOnCancellation { sm.unregisterListener(listener) }
      }
    } ?: error("Step counter gave no reading within ${SENSOR_TIMEOUT_MS / 1000}s")
  }

  private fun healthConnect(ctx: Context): HealthConnectClient {
    val status = HealthConnectClient.getSdkStatus(ctx)
    if (status != HealthConnectClient.SDK_AVAILABLE) error("Health Connect not available (status $status)")
    return HealthConnectClient.getOrCreate(ctx)
  }

  private fun blockedRanges(ctx: Context): List<Pair<Long, Long>> =
    (prefs(ctx).getString("blockedRanges", "") ?: "").split(";").mapNotNull { part ->
      val bits = part.split(",")
      if (bits.size == 2) bits[0].toLongOrNull()?.let { s -> bits[1].toLongOrNull()?.let { e -> s to e } } else null
    }

  /**
   * This app's records in the window. Reading in the background needs
   * READ_HEALTH_DATA_IN_BACKGROUND, which may be missing; then we rely on the
   * ranges mirrored from JS (blockedRanges) instead.
   */
  private suspend fun readOwnRanges(client: HealthConnectClient, ctx: Context, start: Long, end: Long): List<Pair<Long, Long>> =
    try {
      val out = mutableListOf<Pair<Long, Long>>()
      var token: String? = null
      do {
        val res = client.readRecords(
          ReadRecordsRequest(
            recordType = StepsRecord::class,
            // Widen the window a bit so records that start earlier are included.
            timeRangeFilter = TimeRangeFilter.between(
              Instant.ofEpochMilli(start - 12 * 3_600_000L), Instant.ofEpochMilli(end)
            ),
            dataOriginFilter = setOf(DataOrigin(ctx.packageName)),
            pageToken = token,
          )
        )
        res.records.forEach { out += it.startTime.toEpochMilli() to it.endTime.toEpochMilli() }
        token = res.pageToken?.takeIf { it.isNotEmpty() }
      } while (token != null)
      out
    } catch (e: Exception) {
      emptyList()
    }

  /** [start, end] minus the busy ranges. */
  private fun freeRanges(start: Long, end: Long, busy: List<Pair<Long, Long>>): List<Pair<Long, Long>> {
    val free = mutableListOf<Pair<Long, Long>>()
    var cursor = start
    for ((bs, be) in busy.filter { it.first < end && it.second > start }.sortedBy { it.first }) {
      if (bs > cursor) free += cursor to minOf(bs, end)
      cursor = maxOf(cursor, be)
    }
    if (cursor < end) free += cursor to end
    return free
  }

  /** Splits `total` steps across the free ranges, proportional to their length. */
  private fun split(total: Long, free: List<Pair<Long, Long>>): List<Triple<Long, Long, Long>> {
    val totalMs = free.sumOf { it.second - it.first }.toDouble()
    val parts = free.map { (s, e) -> Triple(s, e, (total * (e - s) / totalMs).toLong()) }.toMutableList()
    // Rounding leftovers go to the longest range so the sum is exact.
    val leftover = total - parts.sumOf { it.third }
    val longest = parts.indices.maxBy { parts[it].second - parts[it].first }
    parts[longest] = parts[longest].copy(third = parts[longest].third + leftover)
    return parts.filter { it.third > 0 }
  }
}
