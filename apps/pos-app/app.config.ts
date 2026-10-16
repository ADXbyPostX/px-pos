import type { ConfigContext, ExpoConfig } from "expo/config";
import pkg from "./package.json";

/** The app's version lives in package.json; Android's versionCode follows it (1.0.1 → 10001). */
const version = pkg.version;
const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);

/**
 * PX POS terminal. Dev build only (never Expo Go): @react-native-firebase is native.
 * Icons in assets/generated come from `npm run icons` (root), sourced from assets/brand/favicon.
 * google-services.json / GoogleService-Info.plist are gitignored; fetch with
 *   npx -y firebase-tools@15.29.0 apps:sdkconfig ANDROID|IOS <appId> -o <file> --account adxbypostx@gmail.com --project postx-pos
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "PX POS",
  slug: "px-pos",
  scheme: "pxpos",
  version,
  orientation: "default",
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  icon: "./assets/generated/icon.png",
  ios: {
    bundleIdentifier: "in.postx.pxpos",
    buildNumber: version,
    supportsTablet: true,
    requireFullScreen: true,
    googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST ?? "./GoogleService-Info.plist",
    infoPlist: {
      NSLocalNetworkUsageDescription: "PX POS prints receipts and kitchen tickets to printers on your local network.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "in.postx.pxpos",
    versionCode: major * 10000 + minor * 100 + patch,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    adaptiveIcon: {
      foregroundImage: "./assets/generated/adaptive-foreground.png",
      monochromeImage: "./assets/generated/adaptive-monochrome.png",
      backgroundColor: "#000000",
    },
    predictiveBackGestureEnabled: false,
    // Left over from the dev tools and old storage access; the till uses none of them (Play asks about them).
    blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"],
  },
  plugins: [
    "expo-router",
    ["expo-splash-screen", { backgroundColor: "#000000", image: "./assets/generated/splash.png", imageWidth: 200 }],
    "@react-native-firebase/app",
    "@react-native-firebase/auth",
    // RNFB 26 pulls the Firebase iOS SDK via Swift Package Manager, which requires dynamic frameworks.
    // Dev only: an emulator build talks plain HTTP to the local Firebase emulators.
    ["expo-build-properties", { ios: { useFrameworks: "dynamic" }, ...(process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ? { android: { usesCleartextTraffic: true } } : {}) }],
    "expo-screen-orientation",
    "expo-sqlite",
    // Upload key for Google Play (see the plugin).
    "./plugins/with-release-signing",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
