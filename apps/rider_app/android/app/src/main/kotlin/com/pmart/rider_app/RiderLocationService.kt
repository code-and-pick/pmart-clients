package com.pmart.rider_app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

/**
 * 운행 중 위치 전송 포그라운드 서비스 — 앱 화면을 닫아도(최근 앱에서 밀어 닫기) 위치를 이어 보낸다.
 *
 * 배경(2026-11-18): 배차는 최근 2분 안에 위치를 보낸 라이더만 후보로 본다(백엔드 요청 request-background-location-and-list-push).
 * Dart 가 위치를 보내면 앱을 닫는 순간 Flutter 엔진과 함께 멈췄고, 엔진을 살려 두는 방식(#133)은 카카오 지도를 깨뜨려 되돌렸다(#134).
 *
 * 나눠 맡기(둘이 같이 보내지 않는다):
 * - 운행 시작(Dart → [ACTION_START])부터 이 서비스가 상시 알림을 띄워 프로세스를 지킨다. 앱 화면이 있는 동안은 Dart(LocationReporter)가
 *   보내고 토큰 갱신도 Dart 가 한다. 이 서비스는 알림만 둔다.
 * - 화면이 없어지면(MainActivity.onDestroy → [ACTION_TAKEOVER]) 이 서비스가 위치를 받아 `POST /riders/me/locations` 로 보낸다.
 * - 앱을 다시 열어 Dart 가 START 하면 돌려준다. 운행을 끄면 [ACTION_STOP].
 *
 * 토큰(사용자 결정 2026-11-18 "앱이 준 토큰으로만"): Dart 가 넘겨 준 access token 만 쓴다(메모리에만, 디스크·로그에 안 남김).
 * refresh 는 하지 않는다 — 회전·재사용 감지라 앱과 엇갈리면 세션이 폐기된다. 넘겨받은 뒤 토큰이 끝나 401 이 오면 받기를 멈추고
 * "신규배차가 켜져 있어요" 알림을 울린다(닫은 뒤 최대 약 30분 이어짐).
 *
 * 위치는 약 5초마다 받고 10초마다 묶어 보낸다. 실패한 묶음은 같은 Idempotency-Key 로 다음에 다시. 좌표는 로그에 남기지 않는다.
 */
class RiderLocationService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var locationManager: LocationManager? = null

    // Dart 가 넘긴 설정(메모리에만)
    private var baseUrl: String? = null
    private var accessToken: String? = null
    private var deviceId: String? = null
    private var sourceSystem: String = "rider-app"

    /** 올리는 간격 — 맡은 배송이 있으면 5초, 없으면 10초(Dart 가 정해 넘긴다, 2026-11-19 고객 지도 실시간). */
    private var flushMs: Long = FLUSH_MS

    /** true = 앱 화면이 없어져 이 서비스가 보내는 중. false = Dart 가 보내는 중(이 서비스는 알림만). */
    private var sending = false
    private var stoppedForToken = false

    private val buffer = mutableListOf<JSONObject>()
    private var pending: JSONArray? = null
    private var pendingKey: String? = null

    private val listener = LocationListener { loc: Location -> onLocation(loc) }

    private val flushTick = object : Runnable {
        override fun run() {
            flush()
            main.postDelayed(this, flushMs)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopAll()
            ACTION_TOKEN -> intent.getStringExtra(EXTRA_TOKEN)?.let { setToken(it) }
            ACTION_TAKEOVER -> takeOver()
            ACTION_START -> {
                baseUrl = intent.getStringExtra(EXTRA_BASE_URL) ?: baseUrl
                deviceId = intent.getStringExtra(EXTRA_DEVICE_ID) ?: deviceId
                sourceSystem = intent.getStringExtra(EXTRA_SOURCE) ?: sourceSystem
                flushMs = intent.getLongExtra(EXTRA_FLUSH_MS, flushMs).coerceIn(MIN_FLUSH_MS, FLUSH_MS)
                intent.getStringExtra(EXTRA_TOKEN)?.let { accessToken = it }
                // 권한이 그 사이 빠졌으면(설정에서 끔) startForeground 가 SecurityException 으로 앱을 종료한다 — 조용히 내린다.
                try {
                    startInForeground(
                        intent.getStringExtra(EXTRA_TITLE) ?: "픽라이더 운행 중",
                        intent.getStringExtra(EXTRA_TEXT) ?: "배차와 배달을 위해 위치를 보내고 있어요",
                        intent.getStringExtra(EXTRA_CHANNEL) ?: "운행 중 위치 전송",
                    )
                } catch (_: SecurityException) {
                    stopAll()
                    return START_NOT_STICKY
                }
                running = true
                handBack()
            }
            // 시스템이 다시 띄운 것(설정이 없다) — 할 일이 없으니 내린다.
            else -> if (baseUrl == null) stopAll()
        }
        // 프로세스가 죽으면 토큰이 없으니 스스로 다시 켜지지 않는다(앱을 열면 Dart 가 다시 켠다).
        return START_NOT_STICKY
    }

    /** 앱 화면이 없어졌다 — 이제 이 서비스가 보낸다. */
    private fun takeOver() {
        if (baseUrl == null || sending) return
        sending = true
        stoppedForToken = false
        startLocationUpdates()
        main.removeCallbacks(flushTick)
        main.postDelayed(flushTick, flushMs)
    }

    /** Dart 가 (다시) 보낸다 — 알림만 두고 받기를 멈춘다(모아 둔 점은 버린다. Dart 가 곧 새로 보낸다). */
    private fun handBack() {
        sending = false
        stoppedForToken = false
        main.removeCallbacks(flushTick)
        locationManager?.removeUpdates(listener)
        synchronized(buffer) { buffer.clear() }
        pending = null
        pendingKey = null
    }

    private fun setToken(token: String) {
        accessToken = token
    }

    private fun startInForeground(title: String, text: String, channelName: String) {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager?.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW),
            )
        }
        val notification = notification(title, text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun notification(title: String, text: String, channel: String = CHANNEL_ID): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, channel)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(applicationInfo.icon)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val lm = locationManager ?: getSystemService(Context.LOCATION_SERVICE) as LocationManager
        locationManager = lm
        lm.removeUpdates(listener)
        // Android 12+: 기기 내장 fused 위치(GPS·와이파이·기지국 합침)에 높은 정확도·5초 간격을 고정으로 요청한다.
        // GPS·네트워크를 따로 받으면 서 있을 때(가게 앞 등) 갱신이 8~10초로 늘었다(백엔드 측정 2026-11-19).
        // 추가 라이브러리 없이 안드로이드 기본 API 만 쓴다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            lm.allProviders.contains(LocationManager.FUSED_PROVIDER)
        ) {
            val request = LocationRequest.Builder(LOCATION_MS)
                .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(LOCATION_MS)
                .setMinUpdateDistanceMeters(0f)
                .build()
            lm.requestLocationUpdates(LocationManager.FUSED_PROVIDER, request, mainExecutor, listener)
            return
        }
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (lm.isProviderEnabled(provider)) {
                lm.requestLocationUpdates(provider, LOCATION_MS, 0f, listener, Looper.getMainLooper())
            }
        }
    }

    private fun onLocation(loc: Location) {
        if (!sending || stoppedForToken) return
        val point = JSONObject()
            .put("lat", loc.latitude)
            .put("lng", loc.longitude)
            .put("recordedAt", iso(System.currentTimeMillis()))
        synchronized(buffer) {
            buffer.add(point)
            // 오래 못 보내도 메모리가 끝없이 늘지 않게(가장 오래된 것부터 버림)
            while (buffer.size > MAX_BUFFER) buffer.removeAt(0)
        }
    }

    /** 모인 점을 보낸다. 실패한 묶음은 같은 키로 다음에 다시. */
    private fun flush() {
        if (!sending || stoppedForToken) return
        val url = baseUrl ?: return
        val token = accessToken ?: return
        if (pending == null) {
            val points = synchronized(buffer) {
                if (buffer.isEmpty()) return
                JSONArray(buffer.toList()).also { buffer.clear() }
            }
            pending = points
            pendingKey = UUID.randomUUID().toString()
        }
        val key = pendingKey ?: return
        val body = JSONObject().put("points", pending)
        deviceId?.let { body.put("deviceId", it) }
        val json = body.toString()
        io.execute {
            val code = post("$url/riders/me/locations", token, key, json)
            main.post {
                if (pendingKey != key) return@post
                when {
                    code in 200..299 -> {
                        pending = null
                        pendingKey = null
                    }
                    code == 401 && sending -> tokenExpired()
                    // 그 밖(네트워크·5xx·4xx)은 같은 키로 다음 간격에 다시
                }
            }
        }
    }

    private fun post(url: String, token: String, key: String, json: String): Int = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Idempotency-Key", key)
            conn.setRequestProperty("X-Source-System", sourceSystem)
            conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    } catch (_: Exception) {
        -1
    }

    /**
     * 넘겨받은 뒤 토큰이 끝났다(앱을 닫은 지 약 30분) — 위치 받기는 멈추고, 신규배차가 아직 켜져 있다고 알린다
     * (사용자 지시 2026-11-18 "앱을 열어주세요가 아니라 신규배차가 켜져있다는 알림"). 누르면 앱이 열리고 Dart 가 START 해 이어 보낸다.
     * 상시 알림을 같은 번호로 바꿔 띄우되, 조용한 위치 채널이 아니라 소리 나는 채널로 한 번 울린다.
     */
    private fun tokenExpired() {
        stoppedForToken = true
        accessToken = null
        locationManager?.removeUpdates(listener)
        synchronized(buffer) { buffer.clear() }
        pending = null
        pendingKey = null
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(DUTY_CHANNEL_ID, "신규배차 켜짐 알림", NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
        manager.notify(
            NOTIFICATION_ID,
            notification("신규배차가 켜져 있어요", "눌러서 픽라이더 앱으로 가기", DUTY_CHANNEL_ID),
        )
    }

    private fun stopAll() {
        running = false
        sending = false
        main.removeCallbacks(flushTick)
        locationManager?.removeUpdates(listener)
        synchronized(buffer) { buffer.clear() }
        pending = null
        pendingKey = null
        accessToken = null
        baseUrl = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        main.removeCallbacks(flushTick)
        locationManager?.removeUpdates(listener)
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.pmart.rider_app.location.START"
        const val ACTION_TOKEN = "com.pmart.rider_app.location.TOKEN"
        const val ACTION_TAKEOVER = "com.pmart.rider_app.location.TAKEOVER"
        const val ACTION_STOP = "com.pmart.rider_app.location.STOP"
        const val EXTRA_BASE_URL = "baseUrl"
        const val EXTRA_TOKEN = "accessToken"
        const val EXTRA_DEVICE_ID = "deviceId"
        const val EXTRA_SOURCE = "sourceSystem"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_CHANNEL = "channel"
        const val EXTRA_FLUSH_MS = "flushMs"
        private const val MIN_FLUSH_MS = 5_000L

        /** 운행 중인지(START 를 받았고 STOP 전) — MainActivity 가 화면이 없어질 때 넘길지 정한다. */
        @Volatile
        var running = false


        private const val CHANNEL_ID = "rider_location"

        /** 토큰이 끝나 위치 전송이 멈췄을 때 "신규배차가 켜져 있어요" — 소리·진동이 나게 기본 중요도. */
        private const val DUTY_CHANNEL_ID = "rider_duty_on"
        private const val NOTIFICATION_ID = 7310
        private const val LOCATION_MS = 5_000L
        private const val FLUSH_MS = 10_000L
        private const val MAX_BUFFER = 720 // 5초 간격 약 1시간

        private fun iso(millis: Long): String =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
                .apply { timeZone = TimeZone.getTimeZone("UTC") }
                .format(Date(millis))
    }
}
