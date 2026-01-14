"use client"

import type React from "react"
import { useState } from "react"
import {
  X,
  LayoutGrid,
  Download,
  FileDown,
  Grid2X2,
  RectangleHorizontal,
  RectangleVertical,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartDisplay } from "@/components/chart-display"
import type { ChartData, ChartGridSize } from "@/lib/types"
import { exportChartAsImage, exportDashboardAsPDF } from "@/lib/export-utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface DashboardViewProps {
  charts: ChartData[]
  onUnpinChart: (chartId: string) => void
  onUpdateChart: (chartId: string, updates: Partial<ChartData>) => void
}

const gridSizeOptions: { size: ChartGridSize; label: string; icon: React.ReactNode }[] = [
  { size: "1x1", label: "Small", icon: <Square className="w-3 h-3" /> },
  { size: "2x1", label: "Wide", icon: <RectangleHorizontal className="w-3 h-3" /> },
  { size: "1x2", label: "Tall", icon: <RectangleVertical className="w-3 h-3" /> },
  { size: "2x2", label: "Large", icon: <Grid2X2 className="w-3 h-3" /> },
]

const getGridClasses = (gridSize: ChartGridSize = "1x1"): string => {
  switch (gridSize) {
    case "2x1":
      return "md:col-span-2 row-span-1"
    case "1x2":
      return "col-span-1 md:row-span-2"
    case "2x2":
      return "md:col-span-2 md:row-span-2"
    case "1x1":
    default:
      return "col-span-1 row-span-1"
  }
}

const getChartHeight = (gridSize: ChartGridSize = "1x1"): string => {
  switch (gridSize) {
    case "1x2":
    case "2x2":
      return "h-[400px]"
    case "2x1":
      return "h-[250px]"
    case "1x1":
    default:
      return "h-[220px]"
  }
}

export function DashboardView({ charts, onUnpinChart, onUpdateChart }: DashboardViewProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportDashboard = async () => {
    setIsExporting(true)
    try {
      await exportDashboardAsPDF(charts.map((c) => ({ id: c.id, title: c.title })))
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportChart = async (chart: ChartData) => {
    await exportChartAsImage(chart.id, chart.title)
  }

  if (charts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-73px)] text-center p-6">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <LayoutGrid className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Your Dashboard is Empty</h2>
        <p className="text-muted-foreground max-w-md">
          Pin charts from the Chat tab to build your custom analytics dashboard. All your important metrics in one
          place.
        </p>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="p-4 sm:p-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground">Dashboard</h2>
            <p className="text-muted-foreground text-xs sm:text-sm">
              {charts.length} chart{charts.length !== 1 ? "s" : ""} — Click size icons to resize
            </p>
          </div>

          <Button
            variant="outline"
            className="gap-2 bg-transparent shrink-0 w-full sm:w-auto"
            onClick={handleExportDashboard}
            disabled={isExporting}
          >
            <FileDown className="w-4 h-4" />
            {isExporting ? "Exporting..." : "Export PDF"}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-min">
          {charts.map((chart) => {
            const gridSize = chart.gridSize || "1x1"

            return (
              <Card
                key={chart.id}
                id={`chart-${chart.id}`}
                className={`bg-card border-border transition-all ${getGridClasses(gridSize)}`}
              >
                <CardHeader className="pb-2 space-y-0 px-3 sm:px-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:flex-wrap">
                    <div className="min-w-[200px] flex-1 max-w-full space-y-1">
                      <CardTitle className="text-sm sm:text-base font-semibold leading-tight break-words">
                        {chart.title}
                      </CardTitle>
                      <CardDescription className="hidden sm:block text-xs text-muted-foreground leading-snug break-words">
                        {chart.description}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-end shrink-0 self-start sm:self-auto">
                      {gridSizeOptions.map((option) => (
                        <Tooltip key={option.size}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onUpdateChart(chart.id, { gridSize: option.size })}
                              className={`p-1 sm:p-1.5 rounded transition-colors [&_svg]:w-2.5 [&_svg]:h-2.5 [&_svg]:sm:w-3 [&_svg]:sm:h-3 ${
                                gridSize === option.size
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                              }`}
                            >
                              {option.icon}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>{option.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}

                      <div className="w-px h-3 sm:h-4 bg-border mx-0.5 sm:mx-1" />

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleExportChart(chart)}
                            className="p-1 sm:p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors [&_svg]:w-2.5 [&_svg]:h-2.5 [&_svg]:sm:w-3 [&_svg]:sm:h-3"
                          >
                            <Download />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>Download PNG</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onUnpinChart(chart.id)}
                            className="p-1 sm:p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors [&_svg]:w-2.5 [&_svg]:h-2.5 [&_svg]:sm:w-3 [&_svg]:sm:h-3"
                          >
                            <X />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>Unpin</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ChartDisplay chart={chart} height={getChartHeight(gridSize)} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}
