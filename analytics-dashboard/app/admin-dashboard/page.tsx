"use client"

import React, { useState, useEffect } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp } from "lucide-react"

interface RetryMetrics {
  networkRetries?: number
  sqlRegenerationRetries?: number
  totalRetries?: number
  retryDetails?: Array<{
    type: 'network' | 'sql_regeneration'
    attempt: number
    error?: string
    timestamp?: string
    llmResponse?: string
  }>
}

interface LogEntry {
  id: string
  user_prompt: string
  llm_response: string | null
  error_details: string | null
  success_status: boolean
  agent_answered: boolean
  step_failed: string | null
  created_at: string
  response_time_ms: number | null
  retry_metrics: RetryMetrics | null
}

export default function AdminDashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [successFilter, setSuccessFilter] = useState<string>("all")
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (successFilter !== "all") {
        params.set("success_status", successFilter)
      }
      params.set("limit", "100")

      const response = await fetch(`/api/admin/logs?${params.toString()}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to fetch logs (${response.status})`)
      }
      const data = await response.json()
      setLogs(data.logs || [])
    } catch (error) {
      console.error("Error fetching logs:", error)
      // Show user-friendly error message
      alert(`Failed to load logs: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [successFilter])

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const formatTime = (ms: number | null) => {
    if (ms === null) return "N/A"
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const truncate = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + "..."
  }

  return (
    <div className="min-h-screen flex flex-col bg-background p-6">
      <div className="max-w-7xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-4">Admin Dashboard - LLM Interactions</h1>
          
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Filter by Status:</label>
            <Select value={successFilter} onValueChange={setSuccessFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">Success</SelectItem>
                <SelectItem value="false">Failed</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={fetchLogs} variant="outline" size="sm">
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8">No logs found</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User Prompt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Agent Answered</TableHead>
                  <TableHead>Step Failed</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Response Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const isExpanded = expandedRows.has(log.id)
                  return (
                    <React.Fragment key={log.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleRow(log.id)}
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(log.created_at)}
                        </TableCell>
                        <TableCell>{truncate(log.user_prompt)}</TableCell>
                        <TableCell>
                          {log.step_failed === 'guardrail_blocked' ? (
                            <span className="px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-600">
                              Blocked
                            </span>
                          ) : log.success_status ? (
                            <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-600">
                              Success
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-600">
                              Failed
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {log.agent_answered ? "Yes" : "No"}
                        </TableCell>
                        <TableCell>{log.step_failed || "-"}</TableCell>
                        <TableCell>
                          {log.retry_metrics && log.retry_metrics.totalRetries ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium">
                                {log.retry_metrics.totalRetries} total
                              </span>
                              {log.retry_metrics.networkRetries || log.retry_metrics.sqlRegenerationRetries ? (
                                <span className="text-xs text-muted-foreground">
                                  {log.retry_metrics.networkRetries ? `${log.retry_metrics.networkRetries} network` : ''}
                                  {log.retry_metrics.networkRetries && log.retry_metrics.sqlRegenerationRetries ? ', ' : ''}
                                  {log.retry_metrics.sqlRegenerationRetries ? `${log.retry_metrics.sqlRegenerationRetries} SQL` : ''}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell>{formatTime(log.response_time_ms)}</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30">
                            <div className="space-y-4 p-4">
                              <div>
                                <h3 className="font-semibold mb-2">User Prompt:</h3>
                                <p className="text-sm bg-background p-2 rounded border">
                                  {log.user_prompt}
                                </p>
                              </div>
                              {log.llm_response && (
                                <div>
                                  <h3 className="font-semibold mb-2">LLM Response:</h3>
                                  <pre className="text-sm bg-background p-2 rounded border overflow-auto max-h-96">
                                    {(() => {
                                      try {
                                        const parsed = typeof log.llm_response === "string" 
                                          ? JSON.parse(log.llm_response)
                                          : log.llm_response
                                        return JSON.stringify(parsed, null, 2)
                                      } catch {
                                        return typeof log.llm_response === "string"
                                          ? log.llm_response
                                          : JSON.stringify(log.llm_response, null, 2)
                                      }
                                    })()}
                                  </pre>
                                </div>
                              )}
                              {log.error_details && (
                                <div>
                                  <h3 className="font-semibold mb-2 text-red-600">
                                    Error Details:
                                  </h3>
                                  <pre className="text-sm bg-background p-2 rounded border overflow-auto max-h-96 text-red-600">
                                    {log.error_details}
                                  </pre>
                                </div>
                              )}
                              {log.retry_metrics && log.retry_metrics.totalRetries && log.retry_metrics.totalRetries > 0 && (
                                <div>
                                  <h3 className="font-semibold mb-2">Retry Metrics:</h3>
                                  <div className="text-sm bg-background p-2 rounded border space-y-2">
                                    <div className="grid grid-cols-3 gap-4">
                                      <div>
                                        <span className="font-medium">Total Retries:</span> {log.retry_metrics.totalRetries}
                                      </div>
                                      {log.retry_metrics.networkRetries !== undefined && (
                                        <div>
                                          <span className="font-medium">Network Retries:</span> {log.retry_metrics.networkRetries}
                                        </div>
                                      )}
                                      {log.retry_metrics.sqlRegenerationRetries !== undefined && (
                                        <div>
                                          <span className="font-medium">SQL Regeneration Retries:</span> {log.retry_metrics.sqlRegenerationRetries}
                                        </div>
                                      )}
                                    </div>
                                    {log.retry_metrics.retryDetails && log.retry_metrics.retryDetails.length > 0 && (
                                      <div className="mt-3">
                                        <span className="font-medium">Retry Details:</span>
                                        <div className="mt-2 space-y-3">
                                          {log.retry_metrics.retryDetails.map((detail, idx) => (
                                            <div key={idx} className="border rounded p-2 bg-background">
                                              <div className="text-xs font-medium mb-1">
                                                <span className="capitalize">{detail.type.replace('_', ' ')}</span> (attempt {detail.attempt})
                                                {detail.timestamp && (
                                                  <span className="text-muted-foreground ml-2">
                                                    {new Date(detail.timestamp).toLocaleTimeString()}
                                                  </span>
                                                )}
                                              </div>
                                              {detail.error && (
                                                <div className="text-xs text-red-600 mb-2">
                                                  Error: {detail.error}
                                                </div>
                                              )}
                                              {detail.llmResponse && (
                                                <div className="mt-2">
                                                  <span className="text-xs font-medium">LLM Response:</span>
                                                  <pre className="text-xs bg-muted p-2 rounded border overflow-auto max-h-48 mt-1">
                                                    {(() => {
                                                      try {
                                                        const parsed = typeof detail.llmResponse === "string" 
                                                          ? JSON.parse(detail.llmResponse)
                                                          : detail.llmResponse
                                                        return JSON.stringify(parsed, null, 2)
                                                      } catch {
                                                        return typeof detail.llmResponse === "string"
                                                          ? detail.llmResponse
                                                          : JSON.stringify(detail.llmResponse, null, 2)
                                                      }
                                                    })()}
                                                  </pre>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

