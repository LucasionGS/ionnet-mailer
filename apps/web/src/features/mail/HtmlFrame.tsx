import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";

const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

function isRemote(url: string): boolean {
  const u = url.trim().toLowerCase();
  return u.startsWith("http:") || u.startsWith("https:") || u.startsWith("//");
}

/** Sanitize message HTML. Local attachment URLs (/api/...) and data: URIs are kept; remote content only when allowed. */
export function sanitizeEmailHtml(html: string, allowRemote: boolean): string {
  const purifier = DOMPurify();
  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    const name = data.attrName.toLowerCase();
    if (name === "target") {
      data.keepAttr = false;
      return;
    }
    if (!allowRemote) {
      if ((name === "src" || name === "srcset" || name === "poster" || name === "background") && isRemote(data.attrValue)) {
        data.attrValue = name === "srcset" ? "" : PLACEHOLDER;
        if (node instanceof Element) node.setAttribute("data-remote-blocked", "1");
      }
      if (name === "style" && /url\s*\(\s*['"]?\s*(https?:)?\/\//i.test(data.attrValue)) {
        data.attrValue = data.attrValue.replace(/url\s*\([^)]*\)/gi, "none");
      }
    }
  });
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
  return purifier.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "meta", "link", "base"],
    FORBID_ATTR: ["onerror", "onload", "formaction"],
    ADD_ATTR: ["target"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

export function htmlHasRemoteContent(html: string): boolean {
  return /(src|srcset|background)\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\s*\(\s*['"]?\s*(https?:)?\/\//i.test(html);
}

const FRAME_CSS = `
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 14px; line-height: 1.5; color: __FG__; background: transparent;
    word-wrap: break-word; overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  img[data-remote-blocked] { min-width: 16px; min-height: 16px; background: __PH__; border: 1px dashed __BORDER__; }
  blockquote { border-left: 3px solid __BORDER__; margin: 0.5em 0; padding-left: 0.75em; color: __MUTED__; }
  a { color: __ACCENT__; }
  pre { white-space: pre-wrap; }
  table { max-width: 100%; }
`;

export function HtmlFrame({ html, allowRemote, dark }: { html: string; allowRemote: boolean; dark: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = useMemo(() => {
    const body = sanitizeEmailHtml(html, allowRemote);
    const css = FRAME_CSS.replace("__FG__", dark ? "#e8eaee" : "#16181d")
      .replace("__MUTED__", dark ? "#a0a6b1" : "#5b6270")
      .replaceAll("__BORDER__", dark ? "#3a404b" : "#c9cdd4")
      .replace("__ACCENT__", dark ? "#60a5fa" : "#2563eb")
      .replace("__PH__", dark ? "#262b34" : "#e7e9ec");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${css}</style></head><body>${body}</body></html>`;
  }, [html, allowRemote, dark]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let ro: ResizeObserver | undefined;
    const measure = () => {
      const d = el.contentDocument;
      if (!d?.body) return;
      const h = Math.max(d.documentElement.scrollHeight, d.body.scrollHeight, d.body.offsetHeight);
      setHeight(Math.min(Math.max(h + 8, 40), 20000));
    };
    const onLoad = () => {
      measure();
      const d = el.contentDocument;
      if (d?.body && "ResizeObserver" in window) {
        ro = new ResizeObserver(measure);
        ro.observe(d.body);
      }
      d?.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    };
    el.addEventListener("load", onLoad);
    return () => {
      el.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [doc]);

  return (
    <iframe
      ref={ref}
      title="Message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className="block w-full border-0 bg-transparent"
      style={{ height }}
    />
  );
}
