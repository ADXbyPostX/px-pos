const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Expo SDK 57 detects the npm workspace automatically (watchFolders / nodeModulesPaths).
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
