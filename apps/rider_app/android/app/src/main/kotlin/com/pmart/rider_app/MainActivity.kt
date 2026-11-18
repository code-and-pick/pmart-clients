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
 * - `pmart.rider/location`: 운행 중 위치 전송 서비스([RiderLocationService]) — `start`·`token`·`stop`. 화면이 없어지면 서비스가 넘겨받는다.
 * - `pmart.rider/knnavi`: 카카오내비 SDK 앱 안 음성 길안내([KnNaviActivity]).
 *   `probe`(appKey) → SDK 인증만 확인, `start`(appKey, goal…, start…) → 길안내 화면.
 *   결과: null = 성공, 문자열 = KNError 코드(예: C103 인증 실패).
 */
class MainActivity : FlutterActivity() {
    private var pending: MethodChannel.Result? = null
    private var pendingNavi: MethodChannel.Result? = null

    // 엔진을 직접 만들어 살려 두던 것(#133 — 앱을 닫아도 위치 전송)은 되돌렸다(2026-11-18):
    // 카카오 지도 플러그인(kakao_map_sdk 1.3.1)이 화면(Activity) 시작에 맞춰 뷰 팩토리를 등록·생명주기를 붙이는데,
    // 엔진을 host 가 넘기면 지도가 준비되지 못해(LabelManager is null) 지도가 하얗게 비었다(사용자 "갑자기 지도 안 뜬다").
    // 앱을 닫아도 위치를 보내는 것은 지도와 엮이지 않는 다른 방식으로 다시 한다.

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
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LOCATION_CHANNEL)
            .setMethodCallHandler { call, result ->
                val service = Intent(this, RiderLocationService::class.java)
                try {
                    when (call.method) {
                        "start" -> {
                            service.action = RiderLocationService.ACTION_START
                            for (k in listOf(
                                RiderLocationService.EXTRA_BASE_URL,
                                RiderLocationService.EXTRA_TOKEN,
                                RiderLocationService.EXTRA_DEVICE_ID,
                                RiderLocationService.EXTRA_SOURCE,
                                RiderLocationService.EXTRA_TITLE,
                                RiderLocationService.EXTRA_TEXT,
                                RiderLocationService.EXTRA_CHANNEL,
                            )) {
                                call.argument<String>(k)?.let { service.putExtra(k, it) }
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                startForegroundService(service)
                            } else {
                                startService(service)
                            }
                        }
                        "token" -> {
                            if (!RiderLocationService.running) {
                                result.success(false)
                                return@setMethodCallHandler
                            }
                            service.action = RiderLocationService.ACTION_TOKEN
                            service.putExtra(RiderLocationService.EXTRA_TOKEN, call.argument<String>("accessToken"))
                            startService(service)
                        }
                        "stop" -> {
                            if (!RiderLocationService.running) {
                                result.success(true)
                                return@setMethodCallHandler
                            }
                            service.action = RiderLocationService.ACTION_STOP
                            startService(service)
                        }
                        else -> {
                            result.notImplemented()
                            return@setMethodCallHandler
                        }
                    }
                    result.success(true)
                } catch (_: Exception) {
                    // 백그라운드 시작 제한 등 — 보낼 수 없다는 것만 알린다(토큰 값은 남기지 않는다)
                    result.success(false)
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



    /**
     * 화면이 없어진다(최근 앱에서 밀어 닫기·뒤로 가기로 끝내기) — Flutter 엔진도 함께 없어져 Dart 가 위치를 못 보낸다.
     * 운행 중이면 위치 전송을 [RiderLocationService] 에 넘긴다(회전 등 화면 다시 만들기는 제외).
     */
    override fun onDestroy() {
        if (!isChangingConfigurations && RiderLocationService.running) {
            try {
                startService(
                    Intent(this, RiderLocationService::class.java)
                        .setAction(RiderLocationService.ACTION_TAKEOVER),
                )
            } catch (_: Exception) {
                // 넘기지 못하면 상시 알림만 남는다(다시 열면 Dart 가 이어 보낸다).
            }
        }
        super.onDestroy()
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
        const val LOCATION_CHANNEL = "pmart.rider/location"
        const val REQUEST_CODE = 7301
        const val NAVI_REQUEST_CODE = 7302
    }
}
