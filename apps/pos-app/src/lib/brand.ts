/**
 * The only place brand assets are referenced (files in assets/brand, supplied by Mandy).
 * RN bundles images only through static require(); swap the files or these requires.
 *  - main (postxpos): splash, pairing, lock screens
 *  - short (pxpos): nav rail, headers
 *  - mark (PX): compact spots
 */
export const brand = {
  main: { source: require("../../assets/brand/postxpos/postxpos-white.png"), aspect: 6154 / 1190, alt: "PostX POS" },
  short: { source: require("../../assets/brand/pxpos/pxpos-white.png"), aspect: 4468 / 1190, alt: "PX POS" },
  mark: { source: require("../../assets/brand/favicon/px-white-512.png"), aspect: 1, alt: "PX" },
  red: "#fc0303",
  name: "PX POS",
} as const;
