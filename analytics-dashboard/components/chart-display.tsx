"use client"

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ComposedChart,
} from "recharts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ChartData } from "@/lib/types"

interface ChartDisplayProps {
  chart: ChartData
  height?: string
}

const COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#6366f1",
]

const BAR_GAP = "15%"
const BAR_GAP_INNER = 4
const BAR_SIZE = 36

const getBarConfig = (chart: ChartData) => ({
  categoryGap: chart.barCategoryGap ?? BAR_GAP,
  barGap: chart.barGap ?? BAR_GAP_INNER,
  maxSize: chart.barSize ?? BAR_SIZE,
})

export function ChartDisplay({ chart, height = "h-[300px]" }: ChartDisplayProps) {
  const { type, data, dataKey, categoryKey } = chart
  const dataset = data ?? []

  const getBarFill = (index: number) => COLORS[index % COLORS.length]

  const parseHeightPx = (h: string): number | null => {
    const match = /h-\[(\d+)px\]/.exec(h)
    return match ? Number(match[1]) : null
  }

  const baseHeightPx = parseHeightPx(height) ?? 300
  const effectiveHeightPx =
    ["bar", "grouped_bar", "combo"].includes(type) && dataset.length > 0 && dataset.length <= 2
      ? Math.min(baseHeightPx, 240)
      : baseHeightPx

  const narrowWidthPx =
    ["bar", "grouped_bar", "combo"].includes(type) && dataset.length > 0 && dataset.length <= 2
      ? Math.max(360, dataset.length * 220)
      : null

  const commonProps = {
    data: dataset,
    margin: { top: 10, right: 30, left: 20, bottom: 40 },
  }

  const renderChart = () => {
    switch (type) {
      case "bar":
        const barConfig = getBarConfig(chart)
        return (
          <BarChart {...commonProps} barCategoryGap={barConfig.categoryGap} barGap={barConfig.barGap}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey={categoryKey} 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.xAxisLabel || '', angle: 0, position: 'insideBottom', offset: -5, style: { fill: '#9ca3af' } }}
            />
            <YAxis 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.yAxisLabel || '', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} maxBarSize={barConfig.maxSize}>
              {dataset.map((_, index) => (
                <Cell key={`bar-${index}`} fill={getBarFill(index)} />
              ))}
            </Bar>
          </BarChart>
        )

      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey={categoryKey} 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.xAxisLabel || '', angle: 0, position: 'insideBottom', offset: -5, style: { fill: '#9ca3af' } }}
            />
            <YAxis 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.yAxisLabel || '', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke="#2dd4bf"
              strokeWidth={2}
              dot={{ fill: "#2dd4bf", strokeWidth: 2 }}
            />
          </LineChart>
        )

      case "area":
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey={categoryKey} 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.xAxisLabel || '', angle: 0, position: 'insideBottom', offset: -5, style: { fill: '#9ca3af' } }}
            />
            <YAxis 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.yAxisLabel || '', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Area type="monotone" dataKey={dataKey} stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.2} />
          </AreaChart>
        )

      case "pie":
        return (
          <PieChart>
            <Pie
              data={dataset}
              dataKey={dataKey}
              nameKey={categoryKey}
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={{ stroke: "#9ca3af" }}
            >
              {dataset.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Legend />
          </PieChart>
        )

      case "combo":
        // Dual-axis chart (bar + line)
        const comboConfig = getBarConfig(chart)
        return (
          <ComposedChart
            {...commonProps}
            barCategoryGap={comboConfig.categoryGap}
            barGap={comboConfig.barGap}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey={categoryKey} 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.xAxisLabel || '', angle: 0, position: 'insideBottom', offset: -5, style: { fill: '#9ca3af' } }}
            />
            <YAxis 
              yAxisId="left"
              stroke="#2dd4bf" 
              fontSize={12}
              label={{ value: chart.yAxisLabel || chart.primaryLabel || 'Primary', angle: -90, position: 'insideLeft', style: { fill: '#2dd4bf' } }}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              stroke="#a78bfa" 
              fontSize={12}
              label={{ value: chart.secondaryLabel || 'Secondary', angle: 90, position: 'insideRight', style: { fill: '#a78bfa' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Legend />
            <Bar 
              yAxisId="left"
              dataKey={dataKey} 
              fill="#2dd4bf" 
              radius={[4, 4, 0, 0]}
              maxBarSize={comboConfig.maxSize}
              name={chart.primaryLabel || 'Primary'}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey={chart.secondaryDataKey || 'secondaryValue'}
              stroke="#a78bfa"
              strokeWidth={2}
              dot={{ fill: "#a78bfa", strokeWidth: 2 }}
              name={chart.secondaryLabel || 'Secondary'}
            />
          </ComposedChart>
        )

      case "grouped_bar":
        // Side-by-side grouped bars
        const groupedConfig = getBarConfig(chart)
        return (
          <BarChart {...commonProps} barCategoryGap={groupedConfig.categoryGap} barGap={groupedConfig.barGap}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey={categoryKey} 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.xAxisLabel || '', angle: 0, position: 'insideBottom', offset: -5, style: { fill: '#9ca3af' } }}
            />
            <YAxis 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.yAxisLabel || '', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Legend />
            <Bar 
              dataKey={dataKey} 
              fill="#2dd4bf" 
              radius={[4, 4, 0, 0]}
              maxBarSize={groupedConfig.maxSize}
              name={chart.primaryLabel || 'Primary'}
            />
            <Bar 
              dataKey={chart.secondaryDataKey || 'secondaryValue'} 
              fill="#a78bfa" 
              radius={[4, 4, 0, 0]}
              maxBarSize={groupedConfig.maxSize}
              name={chart.secondaryLabel || 'Secondary'}
            />
          </BarChart>
        )

      case "table":
        // Get all unique keys from the data to use as columns
        const columns = dataset.length > 0 ? Object.keys(dataset[0]) : []
        // If no columns found, fall back to category and value
        const tableColumns = columns.length > 0 ? columns : (categoryKey && dataKey ? [categoryKey, dataKey] : [])
        
        // Format column names for display (convert snake_case to Title Case)
        const formatColumnName = (key: string): string => {
          return key
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
        }

        return (
          <div className="w-full overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {tableColumns.map((col) => (
                    <TableHead key={col} className="text-gray-300">
                      {formatColumnName(col)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataset.map((row, index) => (
                  <TableRow key={index} className="border-gray-700">
                    {tableColumns.map((col) => (
                      <TableCell key={col} className="text-gray-200">
                        {row[col] != null ? String(row[col]) : ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )

      default:
        const defaultConfig = getBarConfig(chart)
        return (
          <BarChart {...commonProps} barCategoryGap={defaultConfig.categoryGap} barGap={defaultConfig.barGap}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey={categoryKey} 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.xAxisLabel || '', angle: 0, position: 'insideBottom', offset: -5, style: { fill: '#9ca3af' } }}
            />
            <YAxis 
              stroke="#9ca3af" 
              fontSize={12}
              label={{ value: chart.yAxisLabel || '', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} maxBarSize={defaultConfig.maxSize}>
              {dataset.map((_, index) => (
                <Cell key={`bar-default-${index}`} fill={getBarFill(index)} />
              ))}
            </Bar>
          </BarChart>
        )
    }
  }

  // For tables, don't use ResponsiveContainer (it's for charts)
  if (type === "table") {
    return (
      <div className={`${height} w-full overflow-auto`}>
        {renderChart()}
      </div>
    )
  }

  return (
    <div
      className={`${height} w-full`}
      style={{
        height: `${effectiveHeightPx}px`,
        maxWidth: narrowWidthPx ? `${narrowWidthPx}px` : "100%",
        margin: "0 auto",
        width: "100%",
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {renderChart()}
      </ResponsiveContainer>
    </div>
  )
}
