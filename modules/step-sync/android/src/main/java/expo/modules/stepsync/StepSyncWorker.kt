package expo.modules.stepsync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** Runs every ~15 min via WorkManager, even with the JS side / app UI closed. */
class StepSyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
  override suspend fun doWork(): Result {
    return try {
      Log.i("StepSync", StepSync.sync(applicationContext))
      Result.success()
    } catch (e: Exception) {
      // The error is saved for getStatus(). Report success anyway so WorkManager
      // keeps the normal 15-min schedule instead of piling up retries.
      Log.w("StepSync", "sync failed", e)
      Result.success()
    }
  }
}
