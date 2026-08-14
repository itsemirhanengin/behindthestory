/**
 * The app's design tokens, resolved to hex.
 *
 * `globals.css` defines everything in oklch, which no email client understands,
 * so these are the sRGB conversions of the day-theme values. They are the same
 * colours, not an approximation — if a token changes there, recompute here.
 *
 * The two structural rules of the design system carry over verbatim: no corner
 * radius anywhere, and no shadows. Separation comes from hairline rules and a
 * change of ground, which is exactly what survives an email client intact.
 */
export const email = {
  background: "#f9f6f1",
  foreground: "#1d1916",
  card: "#fefcf8",
  primary: "#622015",
  primaryForeground: "#fcfaf6",
  secondary: "#ede9e1",
  muted: "#f1ede6",
  mutedForeground: "#69625b",
  border: "#ddd8d0",
  alarm: "#9a322a",
} as const;

/**
 * Source Serif/Sans are webfonts; email clients that block them fall back down
 * this stack, so the fallbacks are chosen to keep the same warm, bookish weight
 * rather than dropping to Arial.
 */
export const fonts = {
  serif: "'Source Serif 4', 'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif",
  sans: "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
} as const;
