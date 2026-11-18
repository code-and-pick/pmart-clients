package com.pmart.rider_app

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * - `pmart.rider/notifications`: 위치 전송 상시 알림을 보이려면 Android 13+ 에서 알림 권한이 필요하다.
 * - `pmart.rider/battery`: 배터리 최적화 예외 — `isExempt` → 예외인지, `request` → 시스템 창(없으면 설정 목록)을 연다.
 *   운행·배달 중 제조사 절전이 앱을 종료해 위치 전송이 끊기는 일을 줄인다.
 * - `pmart.rider/knnavi`: 카카오내비 SDK 앱 안 음성 길안내([KnNaviActivity]).
 *   `probe`(appKey) → SDK 인증만 확인, `start`(appKey, goal…, start…) → 길안내 화면.
 *   결과: null = 성공, 문자열 = KNError 코드(예: C103 인증 실패).
 */
class MainActivity : FlutterActivity() {
    private var pending: MethodChannel.Result? = null
    private var pendingNavi: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createPushChannels()
    }

    /**
     * 서버 푸시가 쓰는 알림 채널(notification-service `android.notification.channel_id`, 백엔드 회신 2026-11-17).
     * ID 는 서버가 정했다 — 이름·중요도는 앱이 정한다. 배차 제안만 높음(소리·진동·화면 위 표시).
     */
    private fun createPushChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channels = listOf(
            NotificationChannel("dispatch_offer", getString(R.string.push_channel_dispatch_offer), NotificationManager.IMPORTANCE_HIGH).apply {
                description = getString(R.string.push_channel_dispatch_offer_desc)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 200, 400)
            },
            NotificationChannel("support", getString(R.string.push_channel_support), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = getString(R.string.push_channel_support_desc)
            },
            NotificationChannel("account", getString(R.string.push_channel_account), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = getString(R.string.push_channel_account_desc)
            },
            NotificationChannel("settlement", getString(R.string.push_channel_settlement), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = getString(R.string.push_channel_settlement_desc)
            },
        )
        manager.createNotificationChannels(channels)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                if (call.method != "request") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
                ) {
                    result.success(true)
                    return@setMethodCallHandler
                }
                pending?.success(false)
                pending = result
                requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE
                )
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, BATTERY_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isExempt" -> result.success(isBatteryExempt())
                    "request" -> {
                        if (isBatteryExempt()) {
                            result.success(true)
                            return@setMethodCallHandler
                        }
                        // 시스템 창("배터리 최적화를 중지할까요?")을 띄운다. 못 띄우는 기기는 배터리 최적화 목록 설정을 연다.
                        val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                            .setData(Uri.parse("package:$packageName"))
                        try {
                            startActivity(ask)
                        } catch (_: ActivityNotFoundException) {
                            try {
                                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                            } catch (_: ActivityNotFoundException) {
                                // 설정 화면이 없는 기기 — 할 수 있는 것이 없다.
                            }
                        }
                        // 결과는 창을 닫은 뒤 isExempt 로 다시 확인한다.
                        result.success(false)
                    }
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, NAVI_CHANNEL)
            .setMethodCallHandler { call, result ->
                val appKey = call.argument<String>("appKey")
                val intent = Intent(this, KnNaviActivity::class.java)
                    .putExtra(KnNaviActivity.EXTRA_APP_KEY, appKey)
                when (call.method) {
                    "probe" -> intent.putExtra(KnNaviActivity.EXTRA_PROBE, true)
                    "start" -> {
                        intent.putExtra(KnNaviActivity.EXTRA_GOAL_NAME, call.argument<String>("goalName"))
                        for (k in listOf("goalLat", "goalLng", "startLat", "startLng")) {
                            call.argument<Double>(k)?.let { intent.putExtra(k, it) }
                        }
                    }
                    else -> {
                        result.notImplemented()
                        return@setMethodCallHandler
                    }
                }
                // 이전 요청이 남아 있으면 끝난 것으로 본다(두 번 응답하지 않게).
                pendingNavi?.success("SUPERSEDED")
                pendingNavi = result
                startActivityForResult(intent, NAVI_REQUEST_CODE)
            }
    }

    private fun isBatteryExempt(): Boolean {
        val power = getSystemService(PowerManager::class.java) ?: return false
        return power.isIgnoringBatteryOptimizations(packageName)
    }

    @Deprecated("FlutterActivity 는 Activity Result API 대신 이것을 쓴다")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != NAVI_REQUEST_CODE) return
        val error = data?.getStringExtra(KnNaviActivity.RESULT_ERROR)
        pendingNavi?.success(
            when {
                error != null -> error
                resultCode == Activity.RESULT_OK -> null
                else -> "CANCELLED"
            }
        )
        pendingNavi = null
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CODE) return
        pending?.success(
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        )
        pending = null
    }

    private companion object {
        const val CHANNEL = "pmart.rider/notifications"
        const val NAVI_CHANNEL = "pmart.rider/knnavi"
        const val BATTERY_CHANNEL = "pmart.rider/battery"
        const val REQUEST_CODE = 7301
        const val NAVI_REQUEST_CODE = 7302
    }
}
