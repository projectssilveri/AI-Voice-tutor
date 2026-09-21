"use client";

import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

/**
 * Reusable chart wrappers that take real data.
 *
 * The vendored TailAdmin charts hardcode their own demo series, which is fine
 * for a template and useless for a dashboard. These take props.
 *
 * `ssr: false` matters: ApexCharts reaches for `window` at import time, so
 * rendering it on the server throws.
 */
import { useTheme } from "@/context/ThemeContext";

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
  loading: () => (
    <div className="skeleton-shimmer h-[200px] rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
  ),
});

const FONT = "Outfit, sans-serif";
const BRAND = "#465FFF";
const BRAND_SOFT = "#9CB9FF";
const SUCCESS = "#12B76A";
const WARNING = "#F79009";

/**
 * Shared axis/grid styling so every chart reads as one family.
 *
 * Apex draws to a canvas, so none of this inherits from CSS — a chart is the
 * one part of the interface that has to be told the theme explicitly. Axis
 * labels were a single hardcoded grey that was tuned for the light background
 * and simply carried over into dark, where it sits closer to the panel than to
 * the text beside it.
 */
function baseOptions(dark: boolean): ApexOptions {
  return {
    chart: {
      fontFamily: FONT,
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true, speed: 400 },
    },
    grid: {
      borderColor: dark ? "rgba(148,163,184,0.14)" : "rgba(148,163,184,0.22)",
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 8, right: 8, top: 0 },
    },
    dataLabels: { enabled: false },
    tooltip: tooltipStyle(dark),
    legend: { show: false },
  };
}

/**
 * Tooltip styling, stated rather than left to Apex's theme presets.
 *
 * `theme: "dark"` alone is not enough: Apex renders the tooltip TITLE using the
 * chart's own `foreColor`, so a dark panel ended up with a dark title on it —
 * legible in dark mode, and an unreadable black box on a white page. Two charts
 * also hardcoded `theme: "dark"` and so never picked up the theme-aware
 * default at all.
 *
 * Setting the colours explicitly means the tooltip reads in both themes
 * whatever Apex's presets do next.
 */
function tooltipStyle(dark: boolean) {
  return {
    theme: dark ? "dark" : "light",
    style: { fontFamily: FONT, fontSize: "12px" },
    // Apex tints the tooltip with the series colour unless told not to, which
    // is where the "blue on blue" reading came from on a single-series chart.
    fillSeriesColor: false,
  } as const;
}

/** The one grey used for axis labels, legends and captions inside a chart. */
function muted(dark: boolean): string {
  return dark ? "#8891A4" : "#667085";
}

function axisLabel(dark: boolean) {
  return {
    style: { colors: muted(dark), fontSize: "12px", fontFamily: FONT },
  };
}

export interface SeriesPoint {
  label: string;
  value: number;
}

function EmptyState({ message, height }: { message: string; height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
      style={{ height }}
    >
      {message}
    </div>
  );
}

/** Trend over time — signups, revenue, minutes studied. */
export function AreaChart({
  points,
  height = 220,
  color = BRAND,
  valueSuffix = "",
  emptyMessage = "No data yet.",
}: {
  points: SeriesPoint[];
  height?: number;
  color?: string;
  valueSuffix?: string;
  emptyMessage?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  if (points.length === 0) {
    return <EmptyState message={emptyMessage} height={height} />;
  }

  const options: ApexOptions = {
    ...baseOptions(dark),
    chart: { ...baseOptions(dark).chart, type: "area", height },
    colors: [color],
    stroke: { curve: "smooth", width: 2 },
    fill: {
      type: "gradient",
      gradient: { opacityFrom: 0.4, opacityTo: 0, shadeIntensity: 1 },
    },
    xaxis: {
      categories: points.map((p) => p.label),
      labels: { ...axisLabel(dark), rotate: 0, hideOverlappingLabels: true },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      labels: {
        ...axisLabel(dark),
        formatter: (value: number) => `${Math.round(value)}${valueSuffix}`,
      },
    },
  };

  return (
    <ReactApexChart
      options={options}
      series={[{ name: "value", data: points.map((p) => p.value) }]}
      type="area"
      height={height}
    />
  );
}

/** Comparison across categories — enrolments per course, revenue per course. */
export function BarChart({
  points,
  height = 220,
  color = BRAND,
  horizontal = false,
  valuePrefix = "",
  valueSuffix = "",
  emptyMessage = "No data yet.",
  percentage = false,
}: {
  points: SeriesPoint[];
  height?: number;
  color?: string;
  horizontal?: boolean;
  valuePrefix?: string;
  valueSuffix?: string;
  emptyMessage?: string;
  /**
   * The values are a PERCENTAGE, so the axis runs 0 to 100 whatever the data
   * does. Without it a chart whose highest bar is 50% fills the panel and
   * reads as "half of everything", and one whose highest is 125% — which used
   * to be possible — drew an axis to 150 and made an impossible number look
   * ordinary.
   */
  percentage?: boolean;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  if (points.length === 0) {
    return <EmptyState message={emptyMessage} height={height} />;
  }

  // COUNTS OF THINGS DO NOT HAVE DECIMALS. Apex divides whatever range it is
  // given into five ticks, so a chart whose tallest bar is 1 enrolment was
  // labelled 0.0 / 0.2 / 0.4 / 0.6 / 0.8 / 1.0 — two fifths of a person.
  // When every value is whole, the axis is told to stay whole too.
  const wholeNumbers = points.every((p) => Number.isInteger(p.value));
  const peak = Math.max(...points.map((p) => p.value), 0);

  // WHICH AXIS CARRIES THE NUMBERS DEPENDS ON THE ORIENTATION, and getting it
  // wrong renders nothing at all. In a horizontal bar chart Apex keeps the
  // category names in `xaxis.categories` but draws the VALUE scale along the
  // x-axis; putting `min`/`max` on `yaxis` there constrains the category axis
  // to a numeric range and the chart comes back empty — no bars, no labels,
  // no error. Measured: a 482x220 canvas containing nothing.
  // `toFixed(0)` rather than rounding the data: the value stays exact for the
  // tooltip, and only the AXIS stops inventing precision the measurement never
  // had. Apex types the two axes differently — the x formatter is handed a
  // string, the y formatter a number — so each gets its own.
  const tidy = (n: number) =>
    wholeNumbers || percentage ? n.toFixed(0) : String(n);
  const bounds = percentage
    ? { min: 0, max: 100, tickAmount: 4 }
    : wholeNumbers
      ? // At most one tick per whole number, so a chart topping out at 2 gets
        // 0/1/2 rather than 0/0.4/0.8/1.2/1.6/2.
        { min: 0, tickAmount: Math.min(Math.max(peak, 1), 5) }
      : {};

  const options: ApexOptions = {
    ...baseOptions(dark),
    chart: { ...baseOptions(dark).chart, type: "bar", height },
    colors: [color],
    plotOptions: {
      bar: {
        horizontal,
        borderRadius: 4,
        borderRadiusApplication: "end",
        columnWidth: "45%",
        barHeight: "60%",
      },
    },
    xaxis: {
      categories: points.map((p) => p.label),
      labels: {
        ...axisLabel(dark),
        hideOverlappingLabels: true,
        // Horizontal: THIS axis carries the values, so it wears the formatter.
        ...(horizontal
          ? { formatter: (value: string) => tidy(Number(value)) }
          : {}),
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      ...(horizontal ? bounds : {}),
    },
    yaxis: {
      labels: {
        ...axisLabel(dark),
        // Vertical: the values are here instead.
        ...(horizontal ? {} : { formatter: (value: number) => tidy(value) }),
      },
      ...(horizontal ? {} : bounds),
    },
    tooltip: {
      ...tooltipStyle(dark),
      y: {
        formatter: (value: number) => `${valuePrefix}${value}${valueSuffix}`,
      },
    },
  };

  return (
    <ReactApexChart
      options={options}
      series={[{ name: "value", data: points.map((p) => p.value) }]}
      type="bar"
      height={height}
    />
  );
}

/** Share of a whole — module status, order outcomes. */
export function DonutChart({
  points,
  height = 240,
  colors = [SUCCESS, WARNING, "#98A2B3"],
  centreLabel,
  emptyMessage = "No data yet.",
}: {
  points: SeriesPoint[];
  height?: number;
  colors?: string[];
  centreLabel?: string;
  emptyMessage?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) {
    return <EmptyState message={emptyMessage} height={height} />;
  }

  const options: ApexOptions = {
    chart: { fontFamily: FONT, type: "donut", height },
    colors,
    labels: points.map((p) => p.label),
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    legend: {
      show: true,
      position: "bottom",
      fontFamily: FONT,
      labels: { colors: muted(dark) },
      markers: { size: 6 },
      // The count, next to the label. This panel exists to answer "how many
      // modules are finished"; a legend reading "Completed / In progress / Not
      // started" with the numbers only on hover makes the reader estimate from
      // the arc, or reach for a mouse they may not have.
      formatter: (label: string, opts) =>
        `${label} · ${points[opts.seriesIndex]?.value ?? 0}`,
    },
    plotOptions: {
      pie: {
        donut: {
          size: "70%",
          labels: {
            show: true,
            total: {
              show: true,
              label: centreLabel ?? "Total",
              fontFamily: FONT,
              color: muted(dark),
              formatter: () => String(total),
            },
          },
        },
      },
    },
    tooltip: tooltipStyle(dark),
  };

  return (
    <ReactApexChart
      options={options}
      series={points.map((p) => p.value)}
      type="donut"
      height={height}
    />
  );
}

/** A single figure as a ring — course completion, pass rate. */
export function RadialProgress({
  percent,
  label,
  height = 200,
  color = BRAND,
}: {
  percent: number;
  label: string;
  height?: number;
  color?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const options: ApexOptions = {
    chart: {
      fontFamily: FONT,
      type: "radialBar",
      height,
      sparkline: { enabled: true },
    },
    colors: [color],
    plotOptions: {
      radialBar: {
        startAngle: -110,
        endAngle: 110,
        hollow: { size: "62%" },
        track: { background: "rgba(148,163,184,0.2)", strokeWidth: "100%" },
        dataLabels: {
          name: {
            offsetY: 22,
            color: muted(dark),
            fontSize: "13px",
            fontFamily: FONT,
          },
          value: {
            offsetY: -14,
            fontSize: "28px",
            fontWeight: 700,
            fontFamily: FONT,
            color: muted(dark),
            formatter: (value: number) => `${Math.round(value)}%`,
          },
        },
      },
    },
    labels: [label],
  };

  return (
    <ReactApexChart
      options={options}
      series={[Math.max(0, Math.min(100, percent))]}
      type="radialBar"
      height={height}
    />
  );
}

export const CHART_COLORS = { BRAND, BRAND_SOFT, SUCCESS, WARNING };
