allprojects {
    repositories {
        google()
        mavenCentral()
        // 카카오내비 SDK(KNSDK) 공개 저장소 — 앱 안 음성 길안내(사용자 요청 2026-11-16).
        maven { url = uri("https://devrepo.kakaomobility.com/repository/kakao-mobility-android-knsdk-public/") }
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
