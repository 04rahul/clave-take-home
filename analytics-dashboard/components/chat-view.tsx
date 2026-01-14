"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Send, Loader2, Pin, Plus, History, MessageSquare, PanelLeftClose, PanelLeft, Download, Mic, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartDisplay } from "@/components/chart-display"
import type { ChartData, Message, ChatSession } from "@/lib/types"
import { exportChartAsImage } from "@/lib/export-utils"
import { PROGRESS_MESSAGES } from "@/lib/constants/progress-steps"

// TypeScript definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null
  onend: ((this: SpeechRecognition, ev: Event) => any) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor
    webkitSpeechRecognition: SpeechRecognitionConstructor
  }
}

interface ChatViewProps {
  onPinChart: (chart: ChartData) => void
  chatSessions: ChatSession[]
  currentSession?: ChatSession
  onLoadSession: (session: ChatSession) => void
  onNewChat: () => void
  onMessagesChange: (messages: Message[]) => void
}

export function ChatView({
  onPinChart,
  chatSessions,
  currentSession,
  onLoadSession,
  onNewChat,
  onMessagesChange,
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>(currentSession?.messages || [])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [isRecordingComplete, setIsRecordingComplete] = useState(false)
  const [transcribedText, setTranscribedText] = useState("")
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const transcribedTextRef = useRef<string>("")
  const finalTranscriptRef = useRef<string>("")
  const inputBeforeTranscriptionRef = useRef<string>("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(currentSession?.messages || [])
  }, [currentSession?.id])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (messages.length > 0) {
      onMessagesChange(messages)
    }
  }, [messages])

  // Check browser support for Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition
    setIsSpeechSupported(!!SpeechRecognition)
  }, [])

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
    }
  }, [])

  const handleNewChat = () => {
    setMessages([])
    onNewChat()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    }

    setMessages((prev) => [...prev, userMessage])
    const userQuery = input
    setInput("")
    setIsLoading(true)

      // Create a placeholder message for streaming updates
      const progressMessageId = (Date.now() + 1).toString()
      const progressMessage: Message = {
        id: progressMessageId,
        role: "assistant",
        content: "Processing your query...",
      }
      setMessages((prev) => [...prev, progressMessage])
      
      // Track accumulated insight text for streaming
      let accumulatedInsight = ""

    try {
      const response = await fetch("/api/generate-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userQuery }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: `Error: ${response.status} ${response.statusText}` }
        }

        // Update progress message with error
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === progressMessageId
              ? {
                  ...msg,
                  content: errorData.error || `Error: ${response.status}. Please try rephrasing your request.`,
                }
              : msg
          )
        )
        return
      }

      // Handle streaming response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error("Response body is not readable")
      }

      let buffer = ""
      let currentStep = ""

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE messages
        const lines = buffer.split("\n")
        buffer = lines.pop() || "" // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === "progress") {
                currentStep = data.step
                const message = PROGRESS_MESSAGES[data.step as keyof typeof PROGRESS_MESSAGES] || data.message || "Processing..."

                // Update progress message
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === progressMessageId
                      ? {
                          ...msg,
                          content: message,
                        }
                      : msg
                  )
                )
              } else if (data.type === "insight_chunk") {
                // Accumulate streaming insight chunks
                accumulatedInsight += data.chunk || ""
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === progressMessageId
                      ? {
                          ...msg,
                          content: accumulatedInsight || "Analyzing data...",
                          isStreaming: true, // Add flag to indicate streaming
                        }
                      : msg
                  )
                )
              } else if (data.type === "error") {
                // Check for API key errors and display them prominently
                const errorText = data.error || "An error occurred. Please try again."
                const isAPIKeyError = errorText.toLowerCase().includes('api key') || 
                                     errorText.toLowerCase().includes('openai') ||
                                     errorText.toLowerCase().includes('unauthorized') ||
                                     errorText.toLowerCase().includes('401')
                
                // Update progress message with error
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === progressMessageId
                      ? {
                          ...msg,
                          content: isAPIKeyError 
                            ? `🔑 ${errorText}\n\nPlease check your .env file and ensure OPENAI_MYAPI_KEY is set correctly, then restart the server.`
                            : errorText,
                          isError: true,
                        }
                      : msg
                  )
                )
                setIsLoading(false)
                return
              } else if (data.type === "result") {
                // Replace progress message with final result
                // Use accumulated insight if available, otherwise use the message from result
                const finalContent = accumulatedInsight || data.message || "Here's your chart analysis."
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === progressMessageId
                      ? {
                          ...msg,
                          content: finalContent,
                          chart: data.chart,
                          table: data.table, // Include table if present (for ambiguous queries)
                          isStreaming: false, // Clear streaming flag when result arrives
                        }
                      : msg
                  )
                )
              }
            } catch (error) {
              console.error("Error parsing SSE data:", error)
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.slice(6)) // Remove "data: " prefix
          if (data.type === "result") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === progressMessageId
                  ? {
                      ...msg,
                      content: accumulatedInsight || data.message || "Here's your chart analysis.",
                      chart: data.chart,
                      table: data.table, // Include table if present (for ambiguous queries)
                      isStreaming: false, // Clear streaming flag when result arrives
                    }
                  : msg
              )
            )
          }
        } catch (error) {
          console.error("Error parsing final buffer:", error)
        }
      }
    } catch (error) {
      console.error("Error generating chart:", error)
      // Check for API key errors
      const errorText = error instanceof Error ? error.message : String(error)
      const isAPIKeyError = errorText.toLowerCase().includes('api key') || 
                           errorText.toLowerCase().includes('openai') ||
                           errorText.toLowerCase().includes('unauthorized')
      
      // Update progress message with error
      const errorMessage = isAPIKeyError
        ? `🔑 OpenAI API key is missing or invalid. Please add OPENAI_MYAPI_KEY to your .env file and restart the server.\n\nError details: ${errorText}`
        : "Sorry, I encountered an error generating the chart. Please check your connection and try again."
      
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === progressMessageId
            ? {
                ...msg,
                content: errorMessage,
                isError: true,
              }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownloadChart = async (chart: ChartData) => {
    await exportChartAsImage(chart.id, chart.title)
  }

  const handleStartRecording = () => {
    if (!isSpeechSupported || isRecording || isLoading) return

    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.error("Speech Recognition not supported")
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onstart = () => {
      setIsRecording(true)
      setIsRecordingComplete(false)
      transcribedTextRef.current = ""
      finalTranscriptRef.current = ""
      inputBeforeTranscriptionRef.current = input // Save current input
      setTranscribedText("")
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = ""
      let finalTranscript = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " "
        } else {
          interimTranscript += transcript
        }
      }

      if (finalTranscript) {
        // Add final transcript to the accumulated text
        finalTranscriptRef.current += finalTranscript
        const newText = finalTranscriptRef.current.trim()
        transcribedTextRef.current = newText
        setTranscribedText(newText)
        setIsRecordingComplete(true)
        // Update input to show transcribed text
        const combinedText = inputBeforeTranscriptionRef.current 
          ? `${inputBeforeTranscriptionRef.current} ${newText}`.trim()
          : newText
        setInput(combinedText)
      }
      
      // Always show current state: final transcript + interim in input
      if (interimTranscript) {
        const displayText = (finalTranscriptRef.current + interimTranscript).trim()
        setTranscribedText(displayText)
        const combinedText = inputBeforeTranscriptionRef.current 
          ? `${inputBeforeTranscriptionRef.current} ${displayText}`.trim()
          : displayText
        setInput(combinedText)
      } else if (finalTranscriptRef.current) {
        // If no interim, just show final
        const finalText = finalTranscriptRef.current.trim()
        setTranscribedText(finalText)
        const combinedText = inputBeforeTranscriptionRef.current 
          ? `${inputBeforeTranscriptionRef.current} ${finalText}`.trim()
          : finalText
        setInput(combinedText)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsRecording(false)
      
      // Handle common errors
      if (event.error === "not-allowed") {
        alert("Microphone permission denied. Please allow microphone access to use speech-to-text.")
      } else if (event.error === "no-speech") {
        // User didn't speak, just stop recording silently
        setIsRecording(false)
      } else if (event.error === "aborted") {
        // Recognition was stopped by user (expected behavior), handle silently
        setIsRecording(false)
      } else {
        // Only log and alert for unexpected errors
        console.error("Speech recognition error:", event.error)
        alert("Speech recognition failed. Please try again or type your message.")
      }
    }

    recognition.onend = () => {
      setIsRecording(false)
      // If we have transcribed text, mark as complete
      if (transcribedTextRef.current.trim()) {
        setIsRecordingComplete(true)
      } else {
        // If recording ended without result, reset
        transcribedTextRef.current = ""
        setTranscribedText("")
      }
      recognitionRef.current = null
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
    } catch (error) {
      console.error("Error starting speech recognition:", error)
      setIsRecording(false)
    }
  }

  const handleStopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsRecording(false)
    // If we have transcribed text, mark as complete
    if (transcribedTextRef.current.trim()) {
      setIsRecordingComplete(true)
    }
  }

  const handleAcceptTranscription = () => {
    // Stop any ongoing recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    // Keep the content (it's already in the input field)
    // Just reset transcription states
    transcribedTextRef.current = ""
    finalTranscriptRef.current = ""
    inputBeforeTranscriptionRef.current = ""
    setTranscribedText("")
    setIsRecordingComplete(false)
    setIsRecording(false)
  }

  const handleCancelTranscription = () => {
    // Stop any ongoing recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    // Remove transcribed content - restore to what was there before
    setInput(inputBeforeTranscriptionRef.current)
    // Reset all states
    transcribedTextRef.current = ""
    finalTranscriptRef.current = ""
    inputBeforeTranscriptionRef.current = ""
    setTranscribedText("")
    setIsRecordingComplete(false)
    setIsRecording(false)
  }

  return (
    <div className="flex h-[calc(100vh-73px)] overflow-hidden">
      {sidebarOpen && (
        <aside className="w-64 min-w-[256px] shrink-0 border-r border-border bg-card flex flex-col">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Button onClick={handleNewChat} className="flex-1 gap-2 bg-transparent" variant="outline">
              <Plus className="w-4 h-4" />
              New Chat
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="shrink-0">
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground uppercase tracking-wide">
              <History className="w-3 h-3" />
              Chat History
            </div>
            {chatSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2 py-4">No chat history yet</p>
            ) : (
              <div className="space-y-1 mt-2">
                {chatSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => onLoadSession(session)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      currentSession?.id === session.id
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <span className="truncate">{session.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{session.timestamp.toLocaleDateString()}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {!sidebarOpen && (
          <div className="p-2 border-b border-border">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
              <PanelLeft className="w-4 h-4" />
            </Button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquareIcon className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">AI Chart Generator</h2>
              <p className="text-muted-foreground max-w-md">
                Describe the business metrics you want to visualize and I will generate interactive charts for you. Try
                asking for sales trends, revenue comparisons, or customer analytics.
              </p>
              <div className="mt-6 grid gap-2">
                <SuggestionButton text="Show me total sales by location" onClick={setInput} />
                <SuggestionButton text="List the top 10 selling items" onClick={setInput} />
                <SuggestionButton text="Compare sales between Downtown and Airport" onClick={setInput} />
              </div>
            </div>
          )}

          {messages.map((message) => {
            const isUser = message.role === "user"
            return (
              <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className="w-full max-w-4xl flex flex-col gap-3">
                  {isUser ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-3 shadow-sm border border-primary/30 whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full space-y-3">
                      <div
                        className={`w-full rounded-2xl border px-4 py-3 shadow-sm ${
                          message.isError
                            ? "border-destructive/50 bg-destructive/5"
                            : "border-border/70 bg-gradient-to-br from-card/95 to-background"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Assistant</span>
                          {message.isStreaming && !message.chart && (
                            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                              Live
                            </span>
                          )}
                          {message.isError && <span className="text-destructive font-semibold">Issue</span>}
                        </div>
                        <div className="flex items-start gap-2">
                          {message.isError && (
                            <svg
                              className="w-4 h-4 text-destructive mt-1"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                              />
                            </svg>
                          )}
                          <p
                            className={`whitespace-pre-wrap leading-relaxed ${
                              message.isError ? "text-destructive" : "text-foreground"
                            }`}
                          >
                            {message.content}
                          </p>
                          {message.isStreaming && !message.chart && <ThinkingDots />}
                        </div>
                      </div>

                      {message.table && (
                        <Card id={`table-${message.table.id}`} className="bg-card border-border shadow-sm">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <CardTitle className="text-lg">{message.table.title}</CardTitle>
                                <CardDescription>{message.table.description}</CardDescription>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadChart(message.table!)}
                                  className="gap-2 text-muted-foreground hover:text-foreground"
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <ChartDisplay chart={message.table} />
                          </CardContent>
                        </Card>
                      )}

                      {message.chart && (
                        <Card id={`chart-${message.chart.id}`} className="bg-card border-border shadow-sm">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <CardTitle className="text-lg">{message.chart.title}</CardTitle>
                                <CardDescription>{message.chart.description}</CardDescription>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadChart(message.chart!)}
                                  className="gap-2 text-muted-foreground hover:text-foreground"
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onPinChart(message.chart!)}
                                  className="gap-2"
                                >
                                  <Pin className="w-4 h-4" />
                                  Pin
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <ChartDisplay chart={message.chart} />
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {(() => {
            // Find the most recent assistant message
            const lastAssistantMessage = [...messages].reverse().find(msg => msg.role === "assistant")
            // Only show "Generating chart" if:
            // 1. We're loading
            // 2. Chart is not ready yet
            // 3. We're not currently streaming insight (if streaming, the message will show thinking dots)
            const shouldShow = isLoading && !lastAssistantMessage?.chart && !lastAssistantMessage?.isStreaming
            return shouldShow ? (
              <div className="flex justify-start">
                <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating chart...
                  </div>
                </div>
              </div>
            ) : null
          })()}
          <div ref={messagesEndRef} />
        </div>

        {messages.length > 0 && !isLoading && <SuggestionsBar onSelect={setInput} />}

        <div className="border-t border-border p-4 bg-card">
          <form onSubmit={handleSubmit} className="flex gap-3 items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe the chart you want to create..."
              className="flex-1 bg-secondary border-0 rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isLoading || isRecording}
            />
            {isSpeechSupported && (
              <>
                {!isRecording && !isRecordingComplete && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={isLoading}
                    onClick={handleStartRecording}
                    title="Start recording"
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                )}
                {isRecording && (
                  <div className="flex items-center gap-2">
                    <AudioWaves />
                    <Button
                      type="button"
                      variant="destructive"
                      size="lg"
                      onClick={handleStopRecording}
                      title="Stop recording"
                    >
                      <Mic className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {isRecordingComplete && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={handleAcceptTranscription}
                      title="Accept transcription"
                      className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={handleCancelTranscription}
                      title="Cancel transcription"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
            <Button type="submit" disabled={isLoading || !input.trim() || isRecording} size="lg">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

function AudioWaves() {
  return (
    <div className="flex items-center gap-1 h-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="w-1 bg-primary rounded-full audio-wave-bar"
          style={{
            animationDelay: `${i * 0.1}s`,
            height: '8px',
          }}
        />
      ))}
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 h-4 mt-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 bg-primary rounded-full thinking-dot"
          style={{
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  )
}

function MessageSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
      />
    </svg>
  )
}

function SuggestionButton({
  text,
  onClick,
}: {
  text: string
  onClick: (text: string) => void
}) {
  return (
    <button
      onClick={() => onClick(text)}
      className="px-4 py-2 bg-secondary text-muted-foreground hover:text-foreground rounded-lg text-sm transition-colors hover:bg-secondary/80 text-left"
    >
      {text}
    </button>
  )
}

function SuggestionsBar({ onSelect }: { onSelect: (text: string) => void }) {
  const suggestions = [
    "Show me total sales by location",
    "List the top 10 selling items",
    "Compare sales between Downtown and Airport",
  ]

  return (
    <div className="flex flex-wrap gap-2 px-6 py-3 border-t border-border bg-background/50">
      <span className="text-xs text-muted-foreground self-center mr-2">Suggestions:</span>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          onClick={() => onSelect(suggestion)}
          className="px-3 py-1.5 bg-secondary/50 text-muted-foreground hover:text-foreground rounded-full text-xs transition-colors hover:bg-secondary"
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}
