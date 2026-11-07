# Applied to the app's release build (consumerProguardFiles) because this module pulls in WorkManager.
#
# WorkManager creates its Room database (WorkDatabase_Impl) by reflection through the
# no-arg constructor. With R8 on (release builds) that constructor got stripped:
#   NoSuchMethodException: androidx.work.impl.WorkDatabase_Impl.<init> []
# crashing the app at startup. Keep Room database constructors.
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# Our worker is instantiated by WorkManager from its class name.
-keep class expo.modules.stepsync.StepSyncWorker { <init>(android.content.Context, androidx.work.WorkerParameters); }
