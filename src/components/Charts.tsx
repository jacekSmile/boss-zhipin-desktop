// 纯 SVG 图表：柱状图 + 环形图（含悬停提示）
import { useState } from "react";

export interface ChartDatum {
  label: string;
  value: number;
  color?: string;
}

const PALETTE = [
  "#00b4b4", "#4f8ff7", "#9b7bff", "#f7786b", "#f7b84f",
  "#4fd18b", "#e46bb4", "#6bcbe4", "#b8e44f", "#f78f4f",
];

export function palette(i: number): string {
  return PALETTE[i % PALETTE.length];
}

/** 横向柱状图 */
export function BarChart(props: { title: string; data: ChartDatum[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...props.data.map((d) => d.value));
  const rowH = 30;
  const labelW = 110;
  const valueW = 52;
  const W = 460;
  const barW = W - labelW - valueW;
  const H = props.data.length * rowH + 6;

  return (
    <div className="chart-card">
      <div className="chart-title">{props.title}</div>
      {props.data.length === 0 ? (
        <div className="chart-empty">暂无数据</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
          {props.data.map((d, i) => {
            const y = i * rowH + 4;
            const w = Math.max(2, (d.value / max) * barW);
            return (
              <g
                key={d.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="bar-row"
              >
                <text x={labelW - 8} y={y + rowH / 2 + 2} className="bar-label" textAnchor="end">
                  {d.label.length > 8 ? d.label.slice(0, 8) + "…" : d.label}
                </text>
                <rect x={labelW} y={y} width={barW} height={rowH - 10} rx={4} className="bar-bg" />
                <rect
                  x={labelW}
                  y={y}
                  width={w}
                  height={rowH - 10}
                  rx={4}
                  fill={d.color || palette(i)}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                />
                <text x={labelW + w + 6} y={y + rowH / 2 + 2} className="bar-value">
                  {d.value}
                  {props.unit || ""}
                </text>
                {hover === i && <title>{`${d.label}：${d.value}${props.unit || ""}`}</title>}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** 环形图 */
export function DonutChart(props: { title: string; data: ChartDatum[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = props.data.reduce((s, d) => s + d.value, 0);
  const R = 60;
  const r = 38;
  const CX = 80;
  const CY = 80;

  let angle = -Math.PI / 2;
  const arcs = props.data.map((d, i) => {
    const frac = total > 0 ? d.value / total : 0;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = frac > 0.5 ? 1 : 0;
    const p = (a: number, rad: number) => [CX + rad * Math.cos(a), CY + rad * Math.sin(a)];
    const [x0, y0] = p(a0, R);
    const [x1, y1] = p(a1, R);
    const [x2, y2] = p(a1, r);
    const [x3, y3] = p(a0, r);
    const path =
      frac >= 0.9999
        ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} L ${CX - 0.01} ${CY - r} A ${r} ${r} 0 1 0 ${CX} ${CY - r} Z`
        : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    return { d, i, path, frac, color: d.color || palette(i) };
  });

  const hovered = hover !== null ? arcs[hover] : null;

  return (
    <div className="chart-card">
      <div className="chart-title">{props.title}</div>
      {total === 0 ? (
        <div className="chart-empty">暂无数据</div>
      ) : (
        <div className="donut-flex">
          <svg viewBox="0 0 160 160" className="donut-svg">
            {arcs.map((a) => (
              <path
                key={a.i}
                d={a.path}
                fill={a.color}
                opacity={hover === null || hover === a.i ? 1 : 0.25}
                className="donut-arc"
                onMouseEnter={() => setHover(a.i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${a.d.label}：${a.d.value}（${(a.frac * 100).toFixed(1)}%）`}</title>
              </path>
            ))}
            <text x={CX} y={CY - 4} textAnchor="middle" className="donut-center-main">
              {hovered ? hovered.d.value : total}
            </text>
            <text x={CX} y={CY + 14} textAnchor="middle" className="donut-center-sub">
              {hovered ? hovered.d.label : "总计"}
            </text>
          </svg>
          <div className="donut-legend">
            {arcs.map((a) => (
              <div
                key={a.i}
                className={`legend-item ${hover === a.i ? "hover" : ""}`}
                onMouseEnter={() => setHover(a.i)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="legend-swatch" style={{ background: a.color }} />
                <span className="legend-label">{a.d.label}</span>
                <span className="legend-value">
                  {a.d.value} · {(a.frac * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
