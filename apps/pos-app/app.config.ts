import type { ConfigContext, ExpoConfig } from "expo/config";

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
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  icon: "./assets/generated/icon.png",
  ios: {
    bundleIdentifier: "in.postx.pxpos",
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
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    adaptiveIcon: {
      foregroundImage: "./assets/generated/adaptive-foreground.png",
      monochromeImage: "./assets/generated/adaptive-monochrome.png",
      backgroundColor: "#000000",
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    ["expo-splash-screen", { backgroundColor: "#000000", image: "./assets/generated/splash.png", imageWidth: 200 }],
    "@react-native-firebase/app",
    "@react-native-firebase/auth",
    // RNFB 26 pulls the Firebase iOS SDK via Swift Package Manager, which requires dynamic frameworks.
    ["expo-build-properties", { ios: { useFrameworks: "dynamic" } }],
    "expo-screen-orientation",
    "expo-sqlite",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
