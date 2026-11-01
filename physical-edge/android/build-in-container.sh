#!/bin/sh
set -eu
apt-get update -qq
apt-get install -y -qq curl unzip >/dev/null
export ANDROID_HOME=/work/.android-sdk
export GRADLE_USER_HOME=/work/.gradle-cache
mkdir -p "$ANDROID_HOME/cmdline-tools"
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
 curl -fL --retry 2 https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o /tmp/android-tools.zip
 unzip -q /tmp/android-tools.zip -d "$ANDROID_HOME/cmdline-tools"
 mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'platforms;android-35' 'build-tools;35.0.0' >/dev/null
if [ ! -x /work/.gradle-dist/gradle-8.9/bin/gradle ]; then
 mkdir -p /work/.gradle-dist
 curl -fL --retry 2 https://services.gradle.org/distributions/gradle-8.9-bin.zip -o /tmp/gradle.zip
 unzip -q /tmp/gradle.zip -d /work/.gradle-dist
fi
cd /work/android
/work/.gradle-dist/gradle-8.9/bin/gradle --no-daemon --max-workers=1 -Dorg.gradle.jvmargs=-Xmx1200m assembleDebug
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs app/build/outputs/apk/debug/app-debug.apk
