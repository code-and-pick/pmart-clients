package com.pmart.rider_app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.graphics.Color
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity
import com.kakaomobility.knsdk.KNLanguageType
import com.kakaomobility.knsdk.KNRouteAvoidOption
import com.kakaomobility.knsdk.KNRoutePriority
import com.kakaomobility.knsdk.KNSDK
import com.kakaomobility.knsdk.common.gps.WGS84ToKATEC
import com.kakaomobility.knsdk.common.objects.KNError
import com.kakaomobility.knsdk.common.objects.KNPOI
import com.kakaomobility.knsdk.guidance.knguidance.KNGuidance
import com.kakaomobility.knsdk.guidance.knguidance.KNGuidance_CitsGuideDelegate
import com.kakaomobility.knsdk.guidance.knguidance.KNGuidance_GuideStateDelegate
import com.kakaomobility.knsdk.guidance.knguidance.KNGuidance_LocationGuideDelegate
import com.kakaomobility.knsdk.guidance.knguidance.KNGuidance_RouteGuideDelegate
import com.kakaomobility.knsdk.guidance.knguidance.KNGuidance_SafetyGuideDelegate
import com.kakaomobility.knsdk.guidance.knguidance.KNGuidance_VoiceGuideDelegate
import com.kakaomobility.knsdk.guidance.knguidance.KNGuideRouteChangeReason
import com.kakaomobility.knsdk.guidance.knguidance.KNGuideState
import com.kakaomobility.knsdk.guidance.knguidance.citsguide.KNGuide_Cits
import com.kakaomobility.knsdk.guidance.knguidance.common.KNLocation
import com.kakaomobility.knsdk.guidance.knguidance.locationguide.KNGuide_Location
import com.kakaomobility.knsdk.guidance.knguidance.routeguide.KNGuide_Route
import com.kakaomobility.knsdk.guidance.knguidance.routeguide.objects.KNMultiRouteInfo
import com.kakaomobility.knsdk.guidance.knguidance.safetyguide.KNGuide_Safety
import com.kakaomobility.knsdk.guidance.knguidance.safetyguide.objects.KNSafety
import com.kakaomobility.knsdk.guidance.knguidance.voiceguide.KNGuide_Voice
import com.kakaomobility.knsdk.trip.kntrip.KNTrip
import com.kakaomobility.knsdk.trip.kntrip.knroute.KNRoute
import com.kakaomobility.knsdk.ui.view.KNNaviView
import com.kakaomobility.knsdk.ui.view.KNNaviView_GuideStateDelegate

/**
 * 카카오내비 SDK with UI(KNNaviView) 로 앱 안에서 음성 길안내를 한다.
 *
 * - [EXTRA_PROBE] 이면 화면 없이 SDK 인증만 해 보고 끝낸다(사용 권한 확인용).
 * - 아니면 내 위치 → 목적지(WGS84 → KATEC 변환) 경로를 만들어 길안내를 시작한다.
 * 결과는 [RESULT_ERROR] 에 KNError 코드(성공이면 없음)로 돌려준다. 키·좌표·목적지 이름은 로그에 남기지 않는다.
 */
class KnNaviActivity :
    AppCompatActivity(),
    KNGuidance_GuideStateDelegate,
    KNGuidance_LocationGuideDelegate,
    KNGuidance_RouteGuideDelegate,
    KNGuidance_SafetyGuideDelegate,
    KNGuidance_VoiceGuideDelegate,
    KNGuidance_CitsGuideDelegate,
    KNNaviView_GuideStateDelegate {

    private var naviView: KNNaviView? = null
    private var guidance: KNGuidance? = null
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 카카오 안내: install 은 onCreate 맨 위에서 부른다.
        installOnce(this)
        val appKey = intent.getStringExtra(EXTRA_APP_KEY)
        if (appKey.isNullOrEmpty()) {
            finishWith("NO_APP_KEY")
            return
        }
        val probe = intent.getBooleanExtra(EXTRA_PROBE, false)
        if (!probe) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            // 인증이 끝나기 전에 지도 뷰를 만들면 지도 표면이 검게 남는다(폰 확인 2026-11-16).
            // 인증 동안은 진행 표시만 두고, 인증 뒤에 KNNaviView 를 만든다.
            setContentView(
                FrameLayout(this).apply {
                    setBackgroundColor(Color.BLACK)
                    addView(
                        ProgressBar(this@KnNaviActivity),
                        FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.WRAP_CONTENT,
                            FrameLayout.LayoutParams.WRAP_CONTENT,
                            Gravity.CENTER,
                        ),
                    )
                }
            )
        }
        initialize(appKey) { error ->
            when {
                error != null -> finishWith(error.code)
                probe -> finishWith(null)
                else -> {
                    naviView = KNNaviView(this).also {
                        it.guideStateDelegate = this
                        setContentView(it)
                    }
                    startRoute()
                }
            }
        }
    }

    private fun initialize(appKey: String, done: (KNError?) -> Unit) {
        if (initialized) {
            done(null)
            return
        }
        KNSDK.initializeWithAppKey(
            appKey,
            appVersion(),
            null,
            null,
            KNLanguageType.KNLanguageType_KOREAN,
        ) { error ->
            runOnUiThread {
                if (error == null) initialized = true
                Log.i(TAG, "KNSDK init: ${error?.code ?: "OK"}")
                done(error)
            }
        }
    }

    private fun startRoute() {
        val goalLat = intent.getDoubleExtra(EXTRA_GOAL_LAT, Double.NaN)
        val goalLng = intent.getDoubleExtra(EXTRA_GOAL_LNG, Double.NaN)
        val startLat = intent.getDoubleExtra(EXTRA_START_LAT, Double.NaN)
        val startLng = intent.getDoubleExtra(EXTRA_START_LNG, Double.NaN)
        if (goalLat.isNaN() || goalLng.isNaN() || startLat.isNaN() || startLng.isNaN()) {
            finishWith("NO_COORDINATE")
            return
        }
        val goalName = intent.getStringExtra(EXTRA_GOAL_NAME) ?: getString(R.string.knnavi_goal)
        val start = poi(getString(R.string.knnavi_start), startLng, startLat)
        val goal = poi(goalName, goalLng, goalLat)
        KNSDK.makeTripWithStart(start, goal, null, null) { error, trip ->
            runOnUiThread {
                if (error != null || trip == null) {
                    finishWith(error?.code ?: "NO_TRIP")
                } else {
                    route(trip)
                }
            }
        }
    }

    private fun route(trip: KNTrip) {
        val priority = KNRoutePriority.KNRoutePriority_Recommand
        val avoid = KNRouteAvoidOption.KNRouteAvoidOption_None.value
        trip.routeWithPriority(priority, avoid) { error, _ ->
            runOnUiThread {
                if (error != null) {
                    finishWith(error.code)
                    return@runOnUiThread
                }
                val g = KNSDK.sharedGuidance() ?: run {
                    finishWith("NO_GUIDANCE")
                    return@runOnUiThread
                }
                g.guideStateDelegate = this
                g.locationGuideDelegate = this
                g.routeGuideDelegate = this
                g.safetyGuideDelegate = this
                g.voiceGuideDelegate = this
                g.citsGuideDelegate = this
                guidance = g
                naviView?.initWithGuidance(g, trip, priority, avoid)
                // 길안내가 시작되면 Flutter 쪽에 "시작함"을 알린다(화면은 그대로 둔다).
                setResult(Activity.RESULT_OK, Intent())
            }
        }
    }

    private fun poi(name: String, lng: Double, lat: Double): KNPOI {
        // KNSDK 는 KATEC 좌표를 쓴다. WGS84ToKATEC(경도, 위도).
        val katec = WGS84ToKATEC(lng, lat)
        // 주소 칸은 비운다(고객 주소를 SDK 에 넘기지 않는다).
        return KNPOI(name, katec.x.toInt(), katec.y.toInt(), null)
    }

    private fun appVersion(): String = try {
        val info = if (Build.VERSION.SDK_INT >= 33) {
            packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(packageName, 0)
        }
        info.versionName ?: "1.0.0"
    } catch (_: Exception) {
        "1.0.0"
    }

    private fun finishWith(errorCode: String?) {
        if (finished) return
        finished = true
        if (errorCode != null) Log.w(TAG, "KNSDK error: $errorCode")
        setResult(
            if (errorCode == null) Activity.RESULT_OK else Activity.RESULT_CANCELED,
            Intent().putExtra(RESULT_ERROR, errorCode),
        )
        finish()
    }

    override fun onDestroy() {
        guidance?.stop()
        guidance = null
        super.onDestroy()
    }

    // ---- 길안내 → KNNaviView 로 그대로 넘긴다(안 넘기면 화면이 제대로 그려지지 않는다).

    override fun guidanceGuideStarted(aGuidance: KNGuidance) {
        naviView?.guidanceGuideStarted(aGuidance)
    }

    override fun guidanceCheckingRouteChange(aGuidance: KNGuidance) {
        naviView?.guidanceCheckingRouteChange(aGuidance)
    }

    override fun guidanceRouteUnchanged(aGuidance: KNGuidance) {
        naviView?.guidanceRouteUnchanged(aGuidance)
    }

    override fun guidanceRouteUnchangedWithError(aGuidnace: KNGuidance, aError: KNError) {
        naviView?.guidanceRouteUnchangedWithError(aGuidnace, aError)
    }

    override fun guidanceOutOfRoute(aGuidance: KNGuidance) {
        naviView?.guidanceOutOfRoute(aGuidance)
    }

    override fun guidanceRouteChanged(
        aGuidance: KNGuidance,
        aFromRoute: KNRoute,
        aFromLocation: KNLocation,
        aToRoute: KNRoute,
        aToLocation: KNLocation,
        aChangeReason: KNGuideRouteChangeReason,
    ) {
        naviView?.guidanceRouteChanged(aGuidance)
    }

    override fun guidanceGuideEnded(aGuidance: KNGuidance) {
        naviView?.guidanceGuideEnded(aGuidance, false)
    }

    override fun guidanceDidUpdateRoutes(
        aGuidance: KNGuidance,
        aRoutes: List<KNRoute>,
        aMultiRouteInfo: KNMultiRouteInfo?,
    ) {
        naviView?.guidanceDidUpdateRoutes(aGuidance, aRoutes, aMultiRouteInfo)
    }

    override fun guidanceDidUpdateIndoorRoute(aGuidance: KNGuidance, aRoute: KNRoute?) {
        naviView?.guidanceDidUpdateIndoorRoute(aGuidance, aRoute)
    }

    override fun guidanceDidUpdateLocation(aGuidance: KNGuidance, aLocationGuide: KNGuide_Location) {
        naviView?.guidanceDidUpdateLocation(aGuidance, aLocationGuide)
    }

    override fun guidanceDidUpdateRouteGuide(aGuidance: KNGuidance, aRouteGuide: KNGuide_Route) {
        naviView?.guidanceDidUpdateRouteGuide(aGuidance, aRouteGuide)
    }

    override fun guidanceDidUpdateSafetyGuide(aGuidance: KNGuidance, aSafetyGuide: KNGuide_Safety?) {
        naviView?.guidanceDidUpdateSafetyGuide(aGuidance, aSafetyGuide)
    }

    override fun guidanceDidUpdateAroundSafeties(aGuidance: KNGuidance, aSafeties: List<KNSafety>?) {
        naviView?.guidanceDidUpdateAroundSafeties(aGuidance, aSafeties)
    }

    override fun shouldPlayVoiceGuide(
        aGuidance: KNGuidance,
        aVoiceGuide: KNGuide_Voice,
        aNewData: MutableList<ByteArray>,
    ): Boolean = naviView?.shouldPlayVoiceGuide(aGuidance, aVoiceGuide, aNewData) ?: true

    override fun willPlayVoiceGuide(aGuidance: KNGuidance, aVoiceGuide: KNGuide_Voice) {
        naviView?.willPlayVoiceGuide(aGuidance, aVoiceGuide)
    }

    override fun didFinishPlayVoiceGuide(aGuidance: KNGuidance, aVoiceGuide: KNGuide_Voice) {
        naviView?.didFinishPlayVoiceGuide(aGuidance, aVoiceGuide)
    }

    override fun didUpdateCitsGuide(aGuidance: KNGuidance, aCitsGuide: KNGuide_Cits) {
        // 신호 정보 UI 는 쓰지 않는다.
    }

    // ---- KNNaviView 상태

    override fun naviViewGuideState(state: KNGuideState) = Unit

    override fun naviViewGuideEnded() {
        // 라이더가 안내를 끝냈다 → 앱 배송 화면으로 돌아간다.
        finish()
    }

    companion object {
        private const val TAG = "PmartKnNavi"
        const val EXTRA_APP_KEY = "appKey"
        const val EXTRA_PROBE = "probe"
        const val EXTRA_GOAL_NAME = "goalName"
        const val EXTRA_GOAL_LAT = "goalLat"
        const val EXTRA_GOAL_LNG = "goalLng"
        const val EXTRA_START_LAT = "startLat"
        const val EXTRA_START_LNG = "startLng"
        const val RESULT_ERROR = "error"

        private var installedSdk = false
        private var initialized = false

        fun installOnce(context: Context) {
            if (installedSdk) return
            KNSDK.install(context.applicationContext as android.app.Application, "${context.filesDir}/knsdk")
            installedSdk = true
        }
    }
}
