import { useEffect, useState, useSyncExternalStore } from "react";

export type ThemeSetting = "system" | "light" | "dark";
const KEY = "ionnet.theme";
const ACCENT_KEY = "ionnet.accent";
const listeners = new Set<() => void>();

/** Accent presets: [light, dark]. Everything else (hover, soft, ring, chrome tint) is derived in CSS. */
export const ACCENTS = {
  blue: { label: "Blue", colors: ["#2563eb", "#3b82f6"] },
  teal: { label: "Teal", colors: ["#0f766e", "#1aa596"] },
  green: { label: "Green", colors: ["#15803d", "#2ea660"] },
  violet: { label: "Violet", colors: ["#6d28d9", "#8b6cf0"] },
  rose: { label: "Rose", colors: ["#be185d", "#e0558f"] },
  orange: { label: "Orange", colors: ["#c2410c", "#e2733a"] },
  graphite: { label: "Graphite", colors: ["#374151", "#8a94a6"] },
} as const;
export type AccentName = keyof typeof ACCENTS;
/** A preset name or a custom "#rrggbb". */
export type AccentSetting = AccentName | `#${string}`;

const HEX_RE = /^#[0-9a-f]{6}$/i;

function readAccent(): AccentSetting {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    if (v && (v in ACCENTS || HEX_RE.test(v))) return v as AccentSetting;
  } catch {
    // ignore
  }
  return "blue";
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(hex: string, target: number, amount: number): string {
  const out = rgb(hex).map((c) => Math.round(c + (target - c) * amount));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Custom colors are used as-is in light mode; in dark mode very dark picks are lifted so they stay legible on dark surfaces. */
function accentColor(setting: AccentSetting, dark: boolean): string {
  if (setting in ACCENTS) return ACCENTS[setting as AccentName].colors[dark ? 1 : 0];
  let c: string = setting;
  if (dark) for (let i = 0; i < 6 && luminance(c) < 0.16; i++) c = mix(c, 255, 0.18);
  else for (let i = 0; i < 6 && luminance(c) > 0.45; i++) c = mix(c, 0, 0.15);
  return c;
}

function read(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

let current: ThemeSetting = read();
let accent: AccentSetting = readAccent();

export function setAccent(a: AccentSetting) {
  accent = a;
  try {
    localStorage.setItem(ACCENT_KEY, a);
  } catch {
    // ignore
  }
  apply();
  listeners.forEach((l) => l());
}

export function getTheme(): ThemeSetting {
  return current;
}

export function setTheme(t: ThemeSetting) {
  current = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // ignore
  }
  apply();
  listeners.forEach((l) => l());
}

function resolved(): "light" | "dark" {
  if (current !== "system") return current;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function apply() {
  const dark = resolved() === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const color = accentColor(accent, dark);
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-fg", luminance(color) > 0.4 ? "#111318" : "#ffffff");
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAccent(): [AccentSetting, (a: AccentSetting) => void] {
  return [useSyncExternalStore(subscribe, () => accent), setAccent];
}

/** True when the UI is currently rendered dark, whichever way that was decided. */
export function useIsDark(): boolean {
  const [theme] = useTheme();
  const [sys, setSys] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => setSys(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return theme === "dark" || (theme === "system" && sys);
}

export function useTheme(): [ThemeSetting, (t: ThemeSetting) => void] {
  const t = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return [t, setTheme];
}
