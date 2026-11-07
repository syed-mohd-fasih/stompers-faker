package expo.modules.stepsync

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS bridge for StepSync. See modules/step-sync/index.ts for the TS side. */
class StepSyncModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("StepSync")

    Function("enableSync") { StepSync.enable(context) }
    Function("disableSync") { StepSync.disable(context) }
    Function("getStatus") { StepSync.status(context) }
    Function("setBlockedRanges") { flat: List<Double> -> StepSync.setBlockedRanges(context, flat) }

    AsyncFunction("syncNow") Coroutine { -> StepSync.sync(context) }
  }
}
