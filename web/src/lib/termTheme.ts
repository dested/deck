import type { ITheme } from "@xterm/xterm";

// §8.4 ANSI palette. Background matches --bg-panel exactly so the terminal has
// no visible "widget rectangle".
export const TERM_THEME: ITheme = {
  background: "#131418",
  foreground: "#D8DAE0",
  cursor: "#AAB3F0",
  cursorAccent: "#131418",
  selectionBackground: "rgba(110,123,217,0.28)",
  black: "#1A1C21",
  red: "#D75455",
  green: "#46B486",
  yellow: "#D9A03F",
  blue: "#6E7BD9",
  magenta: "#B98AD9",
  cyan: "#5FB8C9",
  white: "#D8DAE0",
  brightBlack: "#4A4D57",
  brightRed: "#E66869",
  brightGreen: "#5BCB9B",
  brightYellow: "#E8B45C",
  brightBlue: "#8B96E8",
  brightMagenta: "#CBA0E8",
  brightCyan: "#79CBDB",
  brightWhite: "#EDEEF2",
};
