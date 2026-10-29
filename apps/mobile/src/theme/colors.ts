/**
 * Dark-only palette. Every value is a hex custom property on `:root` in
 * `src/app/globals.css`. The website has no light scheme.
 */
export const colorScheme = "dark" as const;

export const colors = {
  brand: "#e3b45a",
  brandInk: "#1a1408",
  ink: "#0c0b11",
  ink2: "#101018",
  panel: "#15131c",
  panel2: "#13111a",
  raised: "#1d1a27",
  line: "#2a2536",
  line2: "#3a3449",
  parchment: "#ece6d6",
  body: "#cfc8db",
  label: "#b9b2c7",
  mutedText: "#a39cb2",
  subtle: "#8d869c",
  faint: "#817a93",
  hopeBg: "#2a2416",
  hope: "#f0cf8a",
  fearBg: "#231d36",
  fear: "#c6b6f2",
  violet: "#8f78d8",
  danger: "#ff9a92",
  dangerLine: "#8e2b2b",
  dangerBg: "#2a1012",
  dangerSolid: "#b8322a",
  ok: "#d7f2df",
  okLine: "#2f6a44",
  okBg: "#142a1c",
} as const;

/** CSS custom property on `:root` for each phone color. */
export const colorToken = {
  brand: "--brand",
  brandInk: "--brand-ink",
  ink: "--ink",
  ink2: "--ink-2",
  panel: "--panel",
  panel2: "--panel-2",
  raised: "--raised",
  line: "--line",
  line2: "--line-2",
  parchment: "--parchment",
  body: "--body",
  label: "--label",
  mutedText: "--muted-text",
  subtle: "--subtle",
  faint: "--faint",
  hopeBg: "--hope-bg",
  hope: "--hope",
  fearBg: "--fear-bg",
  fear: "--fear",
  violet: "--violet",
  danger: "--danger",
  dangerLine: "--danger-line",
  dangerBg: "--danger-bg",
  dangerSolid: "--danger-solid",
  ok: "--ok",
  okLine: "--ok-line",
  okBg: "--ok-bg",
} as const satisfies Record<keyof typeof colors, string>;

export type ColorName = keyof typeof colors;
