// Utility functions for exporting charts and dashboard

export async function exportChartAsImage(chartId: string, title: string): Promise<void> {
  const domtoimage = await import("dom-to-image-more")

  const element = document.getElementById(`chart-${chartId}`)
  if (!element) return

  try {
    // dom-to-image-more uses namespace export
    const toPng = (domtoimage as any).toPng || (domtoimage as any).default?.toPng
    if (!toPng) {
      throw new Error("dom-to-image-more toPng method not found")
    }
    
    const dataUrl = await toPng(element, {
      bgcolor: "#1e293b",
      quality: 1.0,
      width: element.scrollWidth,
      height: element.scrollHeight,
    })

    const link = document.createElement("a")
    link.download = `${title.toLowerCase().replace(/\s+/g, "-")}.png`
    link.href = dataUrl
    link.click()
  } catch (error) {
    console.error("Error exporting chart:", error)
    throw error
  }
}

export async function exportDashboardAsPDF(charts: { id: string; title: string }[]): Promise<void> {
  const domtoimage = await import("dom-to-image-more")
  const { default: jsPDF } = await import("jspdf")

  const pdf = new jsPDF("landscape", "mm", "a4")
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 10

  // Add title page
  pdf.setFillColor(15, 23, 42)
  pdf.rect(0, 0, pageWidth, pageHeight, "F")
  pdf.setFontSize(20)
  pdf.setTextColor(255, 255, 255)
  pdf.text("Analytics Dashboard", margin, margin + 10)
  pdf.setFontSize(10)
  pdf.setTextColor(156, 163, 175)
  pdf.text(`Generated on ${new Date().toLocaleDateString()}`, margin, margin + 18)

  let yOffset = margin + 30

  // Get toPng method once
  const toPng = (domtoimage as any).toPng || (domtoimage as any).default?.toPng
  if (!toPng) {
    throw new Error("dom-to-image-more toPng method not found")
  }

  for (let i = 0; i < charts.length; i++) {
    const element = document.getElementById(`chart-${charts[i].id}`)
    if (!element) continue

    try {
      const dataUrl = await toPng(element, {
        bgcolor: "#1e293b",
        quality: 1.0,
        width: element.scrollWidth,
        height: element.scrollHeight,
      })

      const imgWidth = pageWidth - margin * 2
      const imgHeight = (element.scrollHeight * imgWidth) / element.scrollWidth

      // Check if we need a new page
      if (yOffset + imgHeight > pageHeight - margin) {
        pdf.addPage()
        pdf.setFillColor(15, 23, 42)
        pdf.rect(0, 0, pageWidth, pageHeight, "F")
        yOffset = margin
      }

      pdf.addImage(dataUrl, "PNG", margin, yOffset, imgWidth, imgHeight)
      yOffset += imgHeight + 10
    } catch (error) {
      console.error(`Error exporting chart ${charts[i].id}:`, error)
      // Continue with next chart even if one fails
    }
  }

  pdf.save("dashboard.pdf")
}
