import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import axios from 'axios';
import { KBarProvider } from 'kbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Documents from './pages/Documents';
import Tasks from './pages/Tasks';
import Alarms from './pages/Alarms';
import Chat, { ChatMeta, Message, Model, WorkspaceContext } from './pages/Chat/Chat'; // Import types from Chat
import CommandPalette from './components/CommandPalette';
import ActivityFeed, { ActivityItem } from './components/ActivityFeed';
import './styles/App.css';
import './styles/force-dark.css'; // Force dark mode
import { v4 as uuidv4 } from 'uuid'; // For generating IDs


// --- Event Bus (Improved implementation) ---
export const eventBus = {
  listeners: {} as Record<string, Array<(data: any) => void>>,
  
  on(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    console.log(`[EventBus] Adding listener for event: ${event}, total listeners: ${this.listeners[event].length + 1}`);
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  },
  
  off(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) return;
    const initialLength = this.listeners[event].length;
    this.listeners[event] = this.listeners[event].filter(listener => listener !== callback);
    console.log(`[EventBus] Removed listener for event: ${event}, before: ${initialLength}, after: ${this.listeners[event].length}`);
  },
  
  emit(event: string, data: any) {
    if (!this.listeners[event]) {
      console.log(`[EventBus] No listeners for event: ${event}`);
      return;
    }
    
    console.log(`[EventBus] Emitting event: ${event} to ${this.listeners[event].length} listeners`);
    
    // Use Promise.resolve().then to ensure event processing happens after the current call stack
    Promise.resolve().then(() => {
      if (!this.listeners[event]) return; // Check again in case listeners were removed
      
      this.listeners[event].forEach(listener => {
        try { 
          listener(data); 
        } catch (e) { 
          console.error(`[EventBus] Error in event listener for ${event}:`, e); 
        }
      });
    });
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

  // --- New Workspace Context State ---
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext>({
    includeProjects: true,
    includeTasks: true,
    includeDocuments: false,
    includeDocumentContent: false,
  });

  // --- Load Workspace Context Settings from localStorage ---
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('workspace_context_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setWorkspaceContext(parsed);
      }
    } catch (e) {
      console.error('Failed to load workspace context settings from localStorage:', e);
    }
  }, []);

  // --- Save Workspace Context Settings to localStorage ---
  useEffect(() => {
    try {
      localStorage.setItem('workspace_context_settings', JSON.stringify(workspaceContext));
    } catch (e) {
      console.error('Failed to save workspace context settings to localStorage:', e);
    }
  }, [workspaceContext]);

  // --- Fetch Initial Chat Data ---
  const fetchInitialChatData = useCallback(async () => {
      setLoadingChats(true);
      setLoadingModels(true);
      setChatError(null);
      let errors: string[] = [];

      // Fetch Sessions
      try {
          // First try the backend API
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
          console.error('Failed to fetch chat sessions from API, using local storage fallback:', err);
          
          // Check if we have any sessions in local storage
          try {
              const savedSessions = localStorage.getItem('chatSessions');
              if (savedSessions) {
                  const parsedSessions = JSON.parse(savedSessions);
                  if (Array.isArray(parsedSessions) && parsedSessions.length > 0) {
                      console.log('Loaded chat sessions from local storage:', parsedSessions);
                      setChatSessions(parsedSessions);
                      if (!selectedChatId) {
                          setSelectedChatId(parsedSessions[0].id);
                      }
                  } else {
                      // Create a new session if nothing in localStorage
                      setChatSessions([]);
                      setSelectedChatId(null);
                      await createNewSession(true);
                  }
              } else {
                  // No sessions in localStorage
                  setChatSessions([]);
                  setSelectedChatId(null);
                  await createNewSession(true);
              }
          } catch (storageErr) {
              console.error('Error accessing localStorage:', storageErr);
              // Only add to errors if both API and localStorage failed
              errors.push("Failed to load chat sessions.");
              setChatSessions([]);
              setSelectedChatId(null);
              await createNewSession(true);
          }
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
          console.error('Failed to fetch chat models from API, trying direct Ollama connection:', err);
          
          // Fallback: Connect directly to Ollama if backend API fails
          try {
              const ollamaResponse = await axios.get('http://localhost:11434/api/tags');
              if (ollamaResponse.data && ollamaResponse.data.models) {
                  const ollamaModels = ollamaResponse.data.models.map(model => ({
                      id: model.name,
                      name: model.name,
                      provider: 'ollama',
                      description: `Ollama model: ${model.name}`
                  }));
                  console.log('Successfully fetched models directly from Ollama:', ollamaModels);
                  setModels(ollamaModels);
                  if (ollamaModels.length > 0 && !selectedModel) {
                      setSelectedModel(ollamaModels[0].id);
                  }
              }
          } catch (ollamaErr) {
              console.error('Failed to connect directly to Ollama:', ollamaErr);
              // Only add to errors if both API and direct connection failed
              errors.push("Failed to load chat models from API and Ollama.");
              
              // Last resort: Use mock models
              const mockModels: Model[] = [
                  { id: 'llama3', name: 'Llama 3 8B (Mock)', provider: 'ollama', description: 'Meta\'s Llama 3 8B model' },
                  { id: 'claude', name: 'Claude (Mock)', provider: 'anthropic', description: 'Mock response only' }
              ];
              setModels(mockModels);
              setSelectedModel(mockModels[0].id);
          }
      } finally {
          setLoadingModels(false);
      }

       if (errors.length > 0) {
           setChatError(errors.join(' '));
       }
  // Remove selectedChatId and selectedModel from dependencies to prevent infinite loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Create New Session ---
  const createNewSession = useCallback(async (localOnly = false) => {
      const id = uuidv4(); // Use uuid for better uniqueness
      const title = `Chat ${new Date().toLocaleString()}`; // More descriptive title
      const newChat: ChatMeta = { id, title, created_at: Date.now(), lastMessage: "New Chat", lastUpdated: new Date().toISOString() };

      if (!localOnly) {
          try {
              await axios.post('http://localhost:8000/chat/sessions', newChat);
              setChatSessions((prev) => {
                const updatedSessions = [newChat, ...prev];
                // Save to localStorage as backup
                try {
                    localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
                } catch (e) {
                    console.error('Failed to save sessions to localStorage:', e);
                }
                return updatedSessions;
              });
              setSelectedChatId(newChat.id); // Select the new chat
              setChatError(null);
          } catch (err) {
              console.error('Failed to create chat session on backend, creating locally:', err);
              setChatSessions((prev) => {
                const updatedSessions = [newChat, ...prev];
                // Save to localStorage as backup
                try {
                    localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
                } catch (e) {
                    console.error('Failed to save sessions to localStorage:', e);
                }
                return updatedSessions;
              });
              setSelectedChatId(newChat.id);
          }
      } else {
           // Add locally only (e.g., when backend fails initial load)
           setChatSessions((prev) => {
             const updatedSessions = [newChat, ...prev];
             // Save to localStorage
             try {
                 localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
             } catch (e) {
                 console.error('Failed to save sessions to localStorage:', e);
             }
             return updatedSessions;
           });
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
                console.log('%cWebSocket message received', 'background: #4CAF50; color: white; padding: 2px 5px; border-radius: 3px;', message);
                
                // Emit specific events
                if (message.type) {
                    // Immediately broadcast all websocket messages to relevant listeners
                    console.log(`Broadcasting websocket message of type: ${message.type}`);
                    
                    // Force state update if it's a chat message
                    if (message.type === 'chat_message_received') {
                        console.log('%cReceived chat message via WebSocket', 'background: #2196F3; color: white; padding: 2px 5px; border-radius: 3px;', message);
                    }
                    
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
                   // Real-time handling for chat messages
                   if (message.type === 'chat_message_received' && message.message) {
                      console.log(`WS: Chat message received for session ${message.session_id}`);
                      // The message is already being broadcasted above, let the Chat component handle updating its state
                   }
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
        <nav className={`sidebar ${isSidebarCollapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width)]'} bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4 flex flex-col overflow-y-auto flex-shrink-0`}>
          <Sidebar
            // --- Pass chat state down ---
            chatSessions={chatSessions}
            selectedChatId={selectedChatId}
            onSelectChat={setSelectedChatId}
            onCreateNewChat={createNewSession}
            onDeleteChat={async (id: string) => { // Add delete handler
                 try {
                     // Try to delete from backend first
                     try {
                         await axios.delete(`http://localhost:8000/chat/sessions/${id}`);
                     } catch (apiErr) {
                         console.warn(`Backend unavailable for session deletion, proceeding with local delete:`, apiErr);
                     }
                     
                     // Always update local state
                     const updatedSessions = chatSessions.filter(s => s.id !== id);
                     setChatSessions(updatedSessions);
                     
                     // Update localStorage
                     try {
                         localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
                         localStorage.removeItem(`chat_messages_${id}`);
                     } catch (storageErr) {
                         console.error('Failed to update localStorage after session deletion:', storageErr);
                     }
                     
                     // Select a different session if needed
                     if (selectedChatId === id) {
                          setSelectedChatId(updatedSessions.length > 0 ? updatedSessions[0].id : null);
                     }
                     
                     // Create a new session if this was the last one
                     if (updatedSessions.length === 0) {
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
            // Pass workspace context to sidebar
            workspaceContext={workspaceContext}
            setWorkspaceContext={setWorkspaceContext}
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
            <Route path="/alarms" element={<Alarms />} />
            <Route
              path="/chat"
              element={
                <Chat
                  selectedChatId={selectedChatId}
                  selectedModelId={selectedModel}
                  models={models}
                  onSessionUpdate={(updatedSession: ChatMeta) => {
                      const updatedSessions = chatSessions.map(s => 
                        s.id === updatedSession.id ? updatedSession : s
                      );
                      setChatSessions(updatedSessions);
                      
                      // Update localStorage
                      try {
                        localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
                      } catch (e) {
                        console.error('Failed to update sessions in localStorage:', e);
                      }
                  }}
                  setChatError={setChatError}
                  chatError={chatError}
                  // Pass workspace context to Chat component
                  workspaceContext={workspaceContext}
                  setWorkspaceContext={setWorkspaceContext}
                />
              }
            />
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