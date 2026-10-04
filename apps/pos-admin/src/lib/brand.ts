/**
 * The only place brand asset paths live (files in public/brand, supplied by Mandy 2026-09-28).
 * Swapping the logo = replace the files and/or edit this object.
 *  - pxpos     short wordmark: loading splash, expanded sidebar, PDFs/print (black on paper)
 *  - postxpos  main wordmark:  /setup
 *  - favicon   PX mark:        collapsed sidebar, 404, browser chrome (src/app/icon.svg etc.)
 */
export const brand = {
  /** Expanded sidebar (on black). SVG viewBox 2234×595. */
  wordmark: { src: "/brand/pxpos/pxpos-white.svg", width: 2234, height: 595, alt: "PX POS" },
  /** Main wordmark (on black). SVG viewBox 3077×595. */
  main: { src: "/brand/postxpos/postxpos-white.svg", width: 3077, height: 595, alt: "PostX POS" },
  /** PX mark (on black), square. */
  mark: { src: "/brand/favicon/px-white.svg", width: 512, height: 512, alt: "PX" },
  /** Paper: black wordmark for printed invoices, reports and PDFs. */
  print: { src: "/brand/pxpos/pxpos-black.png", width: 4468, height: 1190, alt: "PX POS" },
  red: "#fc0303",
  name: "PX POS",
  company: "PostX",
} as const;
