/** @type {import('tailwindcss').Config} */
const c = (v) => `hsl(var(--${v}) / <alpha-value>)`;
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        border: c("border"),
        input: c("input"),
        ring: c("ring"),
        background: c("background"),
        foreground: c("foreground"),
        primary: { DEFAULT: c("primary"), foreground: c("primary-foreground") },
        secondary: { DEFAULT: c("secondary"), foreground: c("secondary-foreground") },
        destructive: { DEFAULT: c("destructive"), foreground: c("foreground") },
        muted: { DEFAULT: c("muted"), foreground: c("muted-foreground") },
        accent: { DEFAULT: c("accent"), foreground: c("accent-foreground") },
        popover: { DEFAULT: c("popover"), foreground: c("popover-foreground") },
        card: { DEFAULT: c("card"), foreground: c("card-foreground") },
        success: c("success"),
        warning: c("warning"),
        qc: c("qc"),
        info: c("info"),
        brand: c("primary"),
      },
      borderRadius: { lg: "10px", md: "8px", sm: "6px", xl: "14px" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
