// @ts-check
const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Signs release builds (the Play upload bundle) with PX POS's own upload key:
 *   apps/pos-app/credentials/pxpos-upload.jks   (gitignored: *.jks)
 * The password lives outside the repo, in ~/.gradle/gradle.properties:
 *   PXPOS_UPLOAD_PASSWORD=…
 * Until both exist, release builds stay on the debug key (cable installs keep working);
 * Play refuses a debug-signed bundle, so a missing key can't slip through to the store.
 */
const MARK = "// px-pos: release signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    const release = `
        release { ${MARK}
            if (pxposUploadKey.exists() && findProperty('PXPOS_UPLOAD_PASSWORD')) {
                storeFile pxposUploadKey
                storePassword findProperty('PXPOS_UPLOAD_PASSWORD')
                keyAlias 'pxpos-upload'
                keyPassword findProperty('PXPOS_UPLOAD_PASSWORD')
            }
        }`;
    g = g.replace(/(signingConfigs\s*\{\s*\n\s*debug\s*\{[^}]*\})/, `$1${release}`);
    g = g.replace(
      /(release\s*\{\s*\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig(pxposUploadKey.exists() && findProperty('PXPOS_UPLOAD_PASSWORD') ? signingConfigs.release : signingConfigs.debug)",
    );
    g = g.replace(/\nandroid\s*\{/, `\ndef pxposUploadKey = file('../../credentials/pxpos-upload.jks')\n\nandroid {`);
    if (!g.includes(MARK) || !g.includes("signingConfigs.release")) throw new Error("with-release-signing: app/build.gradle didn't match the expected template");
    cfg.modResults.contents = g;
    return cfg;
  });
};
