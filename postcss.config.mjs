import path from "node:path";

// Next loads PostCSS plugins by name with require(); a local plugin needs its absolute path (from the project root,
// where Next and Vitest run).
const zoomMedia = path.resolve("postcss-zoom-media.mjs");

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // After Tailwind, so its breakpoints are rewritten too: width / height queries follow the root zoom on mouse
    // screens and stay as written on touch (src/lib/zoom-media.mjs, dcm-jkxa).
    [zoomMedia]: {},
  },
};

export default config;
