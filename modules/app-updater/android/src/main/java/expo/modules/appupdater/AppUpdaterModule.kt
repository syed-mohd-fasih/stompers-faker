package expo.modules.appupdater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * Installs an already-downloaded update APK (Android only). The download itself happens
 * in JS (expo-file-system); this only verifies it and hands it to the system installer,
 * which always asks the user to confirm.
 */
class AppUpdaterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AppUpdater")

    /** Whether the user has allowed this app to install packages ("Install unknown apps"). */
    Function("canInstallPackages") {
      context.packageManager.canRequestPackageInstalls()
    }

    /** Opens the "Install unknown apps" switch for this app. */
    Function("openInstallPermissionSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** SHA-256 (lowercase hex) of a local file; accepts a file:// URI or a path. */
    AsyncFunction("sha256") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        val digest = MessageDigest.getInstance("SHA-256")
        toFile(uri).inputStream().use { input ->
          val buf = ByteArray(1 shl 16)
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            digest.update(buf, 0, n)
          }
        }
        digest.digest().joinToString("") { "%02x".format(it) }
      }
    }

    /**
     * Opens the system installer for the APK. The file must be in the app's cache or files
     * directory: it is shared through expo-file-system's FileProvider.
     */
    Function("installApk") { uri: String ->
      val file = toFile(uri)
      if (!file.exists()) throw UpdaterException("APK not found: ${file.path}")
      val contentUri = FileProvider.getUriForFile(context, "${context.packageName}.FileSystemFileProvider", file)
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(contentUri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  private fun toFile(uri: String): File = File(if (uri.startsWith("file:")) Uri.parse(uri).path!! else uri)
}

private class UpdaterException(message: String) : CodedException(message)
