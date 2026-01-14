"use client"

import { useState } from "react"
import { MessageSquare, LayoutDashboard } from "lucide-react"
import { ChatView } from "@/components/chat-view"
import { DashboardView } from "@/components/dashboard-view"
import type { ChartData, Message, ChatSession } from "@/lib/types"

export default function Home() {
  const [activeTab, setActiveTab] = useState<"chat" | "dashboard">("chat")
  const [pinnedCharts, setPinnedCharts] = useState<ChartData[]>([])
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  const handlePinChart = (chart: ChartData) => {
    setPinnedCharts((prev) => [...prev, { ...chart, id: Date.now().toString(), gridSize: "1x1" }])
  }

  const handleUnpinChart = (chartId: string) => {
    setPinnedCharts((prev) => prev.filter((c) => c.id !== chartId))
  }

  const handleUpdateChart = (chartId: string, updates: Partial<ChartData>) => {
    setPinnedCharts((prev) => prev.map((c) => (c.id === chartId ? { ...c, ...updates } : c)))
  }

  const handleMessagesChange = (messages: Message[]) => {
    if (messages.length === 0) return

    const sessionTitle =
      messages[0]?.content?.slice(0, 30) + (messages[0]?.content?.length > 30 ? "..." : "") || "New Chat"

    if (currentSessionId) {
      setChatSessions((prev) =>
        prev.map((s) => (s.id === currentSessionId ? { ...s, messages, title: sessionTitle } : s)),
      )
    } else if (messages.length > 0) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: sessionTitle,
        timestamp: new Date(),
        messages,
      }
      setChatSessions((prev) => [newSession, ...prev])
      setCurrentSessionId(newSession.id)
    }
  }

  const handleLoadSession = (session: ChatSession) => {
    setCurrentSessionId(session.id)
  }

  const handleNewChat = () => {
    setCurrentSessionId(null)
  }

  const currentSession = chatSessions.find((s) => s.id === currentSessionId)

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top Navigation Tabs */}
      <header className="border-b border-border bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <h1 className="text-xl font-semibold text-foreground">AI Analytics</h1>
          <nav className="flex items-center gap-1 bg-secondary rounded-lg p-1">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "chat"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "dashboard"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
              {pinnedCharts.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-accent/20 text-accent rounded-full">
                  {pinnedCharts.length}
                </span>
              )}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {activeTab === "chat" ? (
          <ChatView
            onPinChart={handlePinChart}
            chatSessions={chatSessions}
            currentSession={currentSession}
            onLoadSession={handleLoadSession}
            onNewChat={handleNewChat}
            onMessagesChange={handleMessagesChange}
          />
        ) : (
          <DashboardView charts={pinnedCharts} onUnpinChart={handleUnpinChart} onUpdateChart={handleUpdateChart} />
        )}
      </main>
    </div>
  )
}
