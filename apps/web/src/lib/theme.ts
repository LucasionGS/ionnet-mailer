import { useEffect, useSyncExternalStore } from "react";

export type ThemeSetting = "system" | "light" | "dark";
const KEY = "ionnet.theme";
const listeners = new Set<() => void>();

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
