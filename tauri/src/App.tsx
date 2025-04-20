import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import axios from 'axios';
import { KBarProvider } from 'kbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Documents from './pages/Documents';
import Tasks from './pages/Tasks';
import Chat, { ChatMeta, Message, Model } from './pages/Chat/Chat'; // Import types from Chat
import CommandPalette from './components/CommandPalette';
import ActivityFeed, { ActivityItem } from './components/ActivityFeed';
import './styles/App.css';
import { v4 as uuidv4 } from 'uuid'; // For generating IDs


// --- Event Bus (Keep as is) ---
export const eventBus = {
  listeners: {} as Record<string, Array<(data: any) => void>>,
  on(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  },
  off(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(listener => listener !== callback);
  },
  emit(event: string, data: any) {
    if (!this.listeners[event]) return;
    setTimeout(() => {
        this.listeners[event]?.forEach(listener => {
            try { listener(data); }
            catch (e) { console.error(`Error in event listener for ${event}:`, e); }
        });
    }, 0);
  },
};


function App() {
  const location = useLocation();
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [wsClient, setWsClient] = useState<WebSocket | null>(null);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const connectIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);

  // --- Lifted Chat State ---
  const [chatSessions, setChatSessions] = useState<ChatMeta[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(''); // Default or first model ID
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null); // Combined error for chat related fetches

  // --- Fetch Initial Chat Data ---
  const fetchInitialChatData = useCallback(async () => {
      setLoadingChats(true);
      setLoadingModels(true);
      setChatError(null);
      let errors: string[] = [];

      // Fetch Sessions
      try {
          const sessionsResponse = await axios.get('http://localhost:8000/chat/sessions');
          const sessionsData = sessionsResponse.data || [];
          setChatSessions(sessionsData);
          if (sessionsData.length > 0 && !selectedChatId) {
              setSelectedChatId(sessionsData[0].id);
          } else if (sessionsData.length === 0) {
               // If no sessions exist, create one
               console.log("No sessions found, creating initial chat...");
               await createNewSession(); // Call the function defined below
          }
      } catch (err) {
          console.error('Failed to fetch chat sessions:', err);
          errors.push("Failed to load chat sessions.");
          // Consider local storage fallback if needed
           setChatSessions([]);
           setSelectedChatId(null);
           // Attempt to create a session locally as fallback
           await createNewSession(true); // Pass flag to indicate local only if needed
      } finally {
          setLoadingChats(false);
      }

      // Fetch Models
      try {
          const modelsResponse = await axios.get('http://localhost:8000/chat/models');
          const modelsData = modelsResponse.data || [];
          setModels(modelsData);
          if (modelsData.length > 0 && !selectedModel) {
              setSelectedModel(modelsData[0].id);
          }
      } catch (err) {
          console.error('Failed to fetch chat models:', err);
          errors.push("Failed to load chat models.");
          // Fallback models
           const mockModels: Model[] = [
                { id: 'llama3', name: 'Llama 3 8B', provider: 'ollama', description: 'Meta\'s Llama 3 8B model' },
                { id: 'claude', name: 'Claude (Mock)', provider: 'anthropic', description: 'Mock response only' }
            ];
           setModels(mockModels);
           setSelectedModel(mockModels[0].id);
      } finally {
          setLoadingModels(false);
      }

       if (errors.length > 0) {
           setChatError(errors.join(' '));
       }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatId, selectedModel]); // Depend on selected states to avoid resetting selection unnecessarily

  // --- Create New Session ---
  const createNewSession = useCallback(async (localOnly = false) => {
      const id = uuidv4(); // Use uuid for better uniqueness
      const title = `Chat ${new Date().toLocaleString()}`; // More descriptive title
      const newChat: ChatMeta = { id, title, created_at: Date.now(), lastMessage: "New Chat", lastUpdated: new Date().toISOString() };

      if (!localOnly) {
          try {
              await axios.post('http://localhost:8000/chat/sessions', newChat);
              setChatSessions((prev) => [newChat, ...prev]);
              setSelectedChatId(newChat.id); // Select the new chat
              setChatError(null);
          } catch (err) {
              console.error('Failed to create chat session on backend:', err);
              setChatError("Failed to create new chat session on server.");
              // Optionally add locally anyway as fallback? For now, show error.
          }
      } else {
           // Add locally only (e.g., when backend fails initial load)
           setChatSessions((prev) => [newChat, ...prev]);
           setSelectedChatId(newChat.id);
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Dependencies needed? Maybe not if always creating unique

    // Initial fetch on mount
    useEffect(() => {
        fetchInitialChatData();
    }, [fetchInitialChatData]);


  // --- WebSocket Connection ---
  useEffect(() => {
    // (WebSocket connection logic - keep mostly as is, but refine event handling)
    let ws: WebSocket | null = null;

    const connectWebSocket = () => {
        if (connectIntervalRef.current) {
            clearTimeout(connectIntervalRef.current);
            connectIntervalRef.current = null;
        }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        console.log("Attempting WebSocket connection to ws://localhost:8000/ws");
        ws = new WebSocket('ws://localhost:8000/ws');
        setWsClient(ws);

        ws.onopen = () => {
            console.log('WebSocket connected');
            setIsWsConnected(true);
            if (connectIntervalRef.current) {
                clearTimeout(connectIntervalRef.current);
                connectIntervalRef.current = null;
            }
             // Refetch data on reconnect? Optional.
             // fetchInitialChatData(); // Could cause loops if connection flaps
        };

        ws.onclose = (event) => {
            console.log(`WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}. Attempting reconnect...`);
            setIsWsConnected(false);
            setWsClient(null);
            ws = null;
            if (!connectIntervalRef.current) {
                 const retry = (delay: number) => {
                     connectIntervalRef.current = setTimeout(() => {
                         console.log(`Retrying WebSocket connection (delay: ${delay}ms)...`);
                         connectWebSocket();
                     }, delay);
                 };
                 retry(2000 + Math.random() * 3000); // Retry after 2-5 seconds
            }
        };

        ws.onerror = (error) => { console.error('WebSocket error:', error); ws?.close(); };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('WebSocket message received:', message);
                // Emit specific events
                if (message.type) {
                   eventBus.emit(message.type, message);

                   // --- Centralized State Updates based on WS ---
                   // Example: Update chat list if a session changes
                   if (message.type === 'chat_session_updated' && message.session_id) {
                       // Could refetch the whole list, or update just the one session
                       console.log(`WS: Session ${message.session_id} updated, refetching list.`);
                       fetchInitialChatData(); // Simplest way to ensure consistency
                   }
                   if (message.type === 'chat_session_deleted' && message.session_id) {
                        console.log(`WS: Session ${message.session_id} deleted, updating list.`);
                        setChatSessions(prev => prev.filter(s => s.id !== message.session_id));
                        if (selectedChatId === message.session_id) {
                            // Select first available session or null
                            setSelectedChatId(chatSessions.length > 1 ? chatSessions.find(s => s.id !== message.session_id)?.id ?? null : null);
                        }
                   }
                   // Note: chat_message_received might need specific handling in the Chat component itself
                   // if real-time updates *within* the current chat are needed without a full state pass.
                }
                 // Handle generic activity log for the feed (assuming it exists)
                 if (message.type === 'activity_log' && message.payload) {
                     const newItem = message.payload as ActivityItem;
                     if (newItem.id && newItem.message && newItem.timestamp) {
                        setActivityItems(prev => [newItem, ...prev.slice(0, 99)]);
                        const announcer = document.getElementById('activity-announcer');
                        if (announcer) announcer.textContent = `New activity: ${newItem.message}`;
                     }
                 }
            } catch (e) { console.error("Failed to parse WebSocket message:", event.data, e); }
        };
    }

    connectWebSocket();

    return () => {
      if (connectIntervalRef.current) { clearTimeout(connectIntervalRef.current); }
      if (wsClient) {
        console.log('Closing WebSocket connection on App unmount.');
        wsClient.onclose = null; wsClient.onerror = null; wsClient.onmessage = null; wsClient.onopen = null;
        wsClient.close();
        setWsClient(null); // Ensure state reflects closure
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Re-run connection logic only on mount

  return (
    <KBarProvider>
      <div className="app-container flex h-screen bg-gray-100 dark:bg-gray-900">
        {/* Sidebar */}
        <nav className="sidebar w-[var(--sidebar-width)] bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4 flex flex-col overflow-y-auto flex-shrink-0">
          <Sidebar
            // --- Pass chat state down ---
            chatSessions={chatSessions}
            selectedChatId={selectedChatId}
            onSelectChat={setSelectedChatId}
            onCreateNewChat={createNewSession}
            onDeleteChat={async (id: string) => { // Add delete handler
                 try {
                     await axios.delete(`http://localhost:8000/chat/sessions/${id}`);
                     setChatSessions(prev => prev.filter(s => s.id !== id));
                     if (selectedChatId === id) {
                          setSelectedChatId(chatSessions.length > 1 ? chatSessions.find(s => s.id !== id)?.id ?? null : null);
                     }
                     if (chatSessions.length === 1 && chatSessions[0].id === id) { // Last one deleted
                         await createNewSession();
                     }
                 } catch (err) {
                     console.error("Failed to delete chat session:", err);
                     setChatError(`Failed to delete chat: ${err}`);
                 }
            }}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            loadingChats={loadingChats}
            loadingModels={loadingModels}
            chatError={chatError}
            isCollapsed={isSidebarCollapsed}
            setCollapsed={setSidebarCollapsed}
          />
        </nav>

        {/* Main Content Area */}
        <main className="main-content flex flex-1 min-h-0 bg-gray-50 dark:bg-gray-900 relative">
          {/* Connection Status Indicator */}
           {!isWsConnected && (
               <div className="sticky top-0 z-50 p-2 bg-yellow-100 dark:bg-yellow-700/60 text-yellow-800 dark:text-yellow-100 text-xs text-center shadow">
                   Connection to backend lost. Attempting to reconnect...
               </div>
           )}
           {/* Router View */}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route
              path="/chat"
              element={
                <Chat
                  // --- Pass needed state down ---
                  selectedChatId={selectedChatId}
                  selectedModelId={selectedModel}
                  models={models} // Pass models for potential display in chat
                  // Function to update the parent's selectedChatId if Chat modifies it (e.g., sets title on first message)
                  onSessionUpdate={(updatedSession: ChatMeta) => {
                      setChatSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
                      // Potentially update selectedChatId if needed, though usually done via sidebar click
                  }}
                  setChatError={setChatError} // Allow Chat to set errors in App
                  chatError={chatError} // <-- PASS THE ERROR STATE DOWN
                />
              }
            />
             {/* <Route path="/chattest" element={<div className="bg-pink-600 w-full h-full flex items-center justify-center text-white text-3xl font-bold">THIS IS A TEST ROUTE WITH PINK BACKGROUND</div>} /> */}
          </Routes>
        </main>

        {/* Activity Feed */}
        <aside className="activity-feed w-[var(--feed-width)] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
           <ActivityFeed initialItems={activityItems} />
           <div className="sr-only" aria-live="polite" id="activity-announcer"></div>
        </aside>

        {/* Command Palette (Portal) */}
        <CommandPalette />
      </div>
    </KBarProvider>
  );
}

export default App;