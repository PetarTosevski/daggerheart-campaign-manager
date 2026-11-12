// PostCSS plugin (dcm-jkxa): rewrites every width / height @media query for the website's root zoom, after Tailwind
// has emitted its breakpoints, so a mouse screen at zoom 0.8 switches layouts where 80% browser zoom did and a touch
// screen keeps the breakpoints as written. The transform and its numbers live in src/lib/zoom-media.mjs.
import { scaleMediaParams } from "./src/lib/zoom-media.mjs";

const zoomMedia = () => ({
  postcssPlugin: "zoom-media",
  AtRule: {
    media(atRule) {
      const next = scaleMediaParams(atRule.params);
      if (next !== atRule.params) atRule.params = next;
    },
  },
});
zoomMedia.postcss = true;

export default zoomMedia;
