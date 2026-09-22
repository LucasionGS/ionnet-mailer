import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ChartSeries<K extends string> {
  key: K;
  label: string;
  /** a CSS colour, normally one of the --chart-N tokens, assigned in order */
  color: string;
}

type Row<K extends string> = { t: string } & Record<K, number>;

const M = { top: 8, right: 4, bottom: 22, left: 34 };
const GAP = 2; // surface-coloured gap between stacked segments
const RADIUS = 4; // rounded data end; square at the baseline

/** Rounds up to 1, 2, 2.5 or 5 × 10ⁿ so the axis ticks are clean whole numbers. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? 10 * mag);
  return { top: Math.ceil(max / step) * step, step };
}

function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function tickLabel(iso: string, bucket: "hour" | "day"): string {
  const d = new Date(iso);
  return bucket === "hour" ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function bucketTitle(iso: string, bucket: "hour" | "day"): string {
  const d = new Date(iso);
  if (bucket === "day") return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const end = new Date(d.getTime() + 3600_000);
  const t = (x: Date) => x.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${t(d)}–${t(end)}`;
}

/**
 * Stacked columns over time buckets. Hover or arrow keys show every series for
 * one bucket; a visually hidden table carries the same numbers for screen readers.
 */
export function ColumnChart<K extends string>({ data, series, bucket, label, height = 180 }: { data: Row<K>[]; series: ChartSeries<K>[]; bucket: "hour" | "day"; label: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = data.length;
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const band = n ? innerW / n : 0;
  const barW = Math.max(2, Math.min(24, band * 0.64));
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] ?? 0), 0));
  const { top, step } = niceScale(Math.max(0, ...totals));
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil((bucket === "hour" ? 40 : 48) / Math.max(band, 1)));

  const indexAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - M.left) / band);
    return i >= 0 && i < n ? i : null;
  };

  const tip = active !== null ? data[active] : null;
  const tipX = active !== null ? M.left + band * (active + 0.5) : 0;
  const flip = tipX > width - 170;

  return (
    <div
      ref={ref}
      className="focus-ring relative w-full rounded-md outline-none select-none"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use the left and right arrow keys to read each ${bucket}.`}
      onPointerMove={(e) => band && setActive(indexAt(e.clientX))}
      onPointerLeave={() => setActive(null)}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
        else if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
        else if (e.key === "Escape") setActive(null);
        else return;
        e.preventDefault();
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--border-strong)" : "var(--border)"} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-faint text-[10px] tabular-nums">
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          {active !== null && <rect x={M.left + band * active} y={M.top} width={band} height={innerH} className="fill-surface-2" />}
          {data.map((d, i) => {
            const x = M.left + band * i + (band - barW) / 2;
            const visible = series.filter((s) => (d[s.key] ?? 0) > 0);
            let acc = 0;
            return (
              <g key={d.t}>
                {visible.map((s, j) => {
                  const v = d[s.key];
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const topmost = j === visible.length - 1;
                  // Leave a gap above every segment but the last so neighbours stay distinct.
                  const h = Math.max(topmost ? y0 - y1 : y0 - y1 - GAP, 1);
                  const yTop = y0 - h;
                  return topmost ? (
                    <path key={s.key} d={topRoundedRect(x, yTop, barW, h, RADIUS)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={x} y={yTop} width={barW} height={h} fill={s.color} />
                  );
                })}
                {(n - 1 - i) % labelEvery === 0 && (
                  <text x={M.left + band * (i + 0.5)} y={height - 6} textAnchor="middle" className="fill-fg-faint text-[10px] tabular-nums">
                    {tickLabel(d.t, bucket)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {tip && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-md border bg-surface px-3 py-2 text-xs shadow-pop"
          style={{ top: M.top, left: flip ? undefined : tipX + barW / 2 + 8, right: flip ? width - tipX + barW / 2 + 8 : undefined }}
        >
          <div className="mb-1.5 font-medium text-fg-muted">{bucketTitle(tip.t, bucket)}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 py-0.5">
              <span className="h-0.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="font-semibold tabular-nums">{(tip[s.key] ?? 0).toLocaleString()}</span>
              <span className="text-fg-muted">{s.label}</span>
            </div>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>{bucket === "hour" ? "Hour" : "Day"}</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.t}>
              <td>{bucketTitle(d.t, bucket)}</td>
              {series.map((s) => (
                <td key={s.key}>{d[s.key] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Legend that doubles as the totals: a swatch, the series name and its sum. */
export function ChartLegend<K extends string>({ series, totals, className }: { series: ChartSeries<K>[]; totals: Record<K, number>; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-5 gap-y-1", className)}>
      {series.map((s) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          <span className="text-xs text-fg-muted">{s.label}</span>
          <span className="text-sm font-semibold">{(totals[s.key] ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
