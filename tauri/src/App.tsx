import React, { useState, useEffect, useRef } from 'react'; // Added useRef
import { Routes, Route } from 'react-router-dom';
import { KBarProvider } from 'kbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Documents from './pages/Documents';
import Tasks from './pages/Tasks';
import Chat from './pages/Chat/Chat'; // Import the proper Chat component
import CommandPalette from './components/CommandPalette';
// import ChatDebug from './pages/Chat/ChatDebug'; // DEBUG: temporary layout test
import ActivityFeed, { ActivityItem } from './components/ActivityFeed'; // Import type and component
import './styles/App.css';

// Simple Event Bus for cross-component communication triggered by WebSocket
export const eventBus = {
  listeners: {} as Record<string, Array<(data: any) => void>>,
  on(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    // Return an unsubscribe function
    return () => this.off(event, callback);
  },
  off(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(listener => listener !== callback);
  },
  emit(event: string, data: any) {
    if (!this.listeners[event]) return;
    // Use setTimeout to ensure state updates triggered by listeners happen outside the current render cycle if needed
    setTimeout(() => {
        this.listeners[event]?.forEach(listener => {
            try {
                listener(data);
            } catch (e) {
                console.error(`Error in event listener for ${event}:`, e);
            }
        });
    }, 0);
  },
};


import { useLocation } from 'react-router-dom';

function App() {
  const location = useLocation();
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [wsClient, setWsClient] = useState<WebSocket | null>(null);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]); // Manage activity feed state here
  const connectIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref to manage reconnect interval


  // Initialize WebSocket connection and reconnection logic
  useEffect(() => {
    let ws: WebSocket | null = null; // Local variable for the connection instance

    const connectWebSocket = () => {
        // Clear previous interval timer if it exists
        if (connectIntervalRef.current) {
            clearTimeout(connectIntervalRef.current); // Use clearTimeout since we use setTimeout for retries
            connectIntervalRef.current = null;
        }

        // Avoid reconnecting if already connected or connecting
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            console.log("WebSocket connection attempt skipped: Already connected or connecting.");
            return;
        }

        console.log("Attempting WebSocket connection to ws://localhost:8000/ws");
        ws = new WebSocket('ws://localhost:8000/ws');
        setWsClient(ws); // Store the WebSocket instance being used

        ws.onopen = () => {
            console.log('WebSocket connected');
            setIsWsConnected(true);
            // Clear interval timer on successful connection
            if (connectIntervalRef.current) {
                clearTimeout(connectIntervalRef.current);
                connectIntervalRef.current = null;
            }
        };

        ws.onclose = (event) => {
            console.log(`WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}. Attempting reconnect...`);
            setIsWsConnected(false);
            setWsClient(null);
            ws = null; // Clear local instance

            // Schedule reconnection attempt only if not already scheduled
            if (!connectIntervalRef.current) {
                 // Simple exponential backoff logic using setTimeout
                 const retry = (delay: number) => {
                     connectIntervalRef.current = setTimeout(() => {
                         console.log(`Retrying WebSocket connection (delay: ${delay}ms)...`);
                         connectWebSocket(); // Attempt to reconnect
                         // Schedule next retry - no need to recursively call retry here, onclose will trigger again if fails
                     }, delay);
                 };
                 retry(1000); // Start with 1 second delay
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            // The 'onclose' event will usually fire after an error, triggering the reconnect logic.
            // Explicitly close if it's in an error state but not closed yet.
            if (ws && ws.readyState !== WebSocket.CLOSED) {
                ws.close();
            }
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('WebSocket message received:', message);
                eventBus.emit('websocket_message', message); // Emit a generic message event

                // Handle specific events for central state (like Activity Feed)
                 if (message.type === 'activity_log' && message.payload) {
                     const newItem = message.payload as ActivityItem;
                     // Ensure required fields exist before adding
                     if (newItem.id && newItem.message && newItem.timestamp) {
                        setActivityItems(prev => [newItem, ...prev.slice(0, 99)]); // Add to start, limit to 100 items
                        // Announce new activity for screen readers (if needed)
                        const announcer = document.getElementById('activity-announcer');
                        if (announcer) {
                            announcer.textContent = `New activity: ${newItem.message}`;
                        }
                     } else {
                         console.warn("Received activity_log payload missing required fields:", message.payload);
                     }
                 } else if (message.type) {
                     // Emit specific event types for components to subscribe to
                     eventBus.emit(message.type, message);
                 } else {
                      console.warn("Received WebSocket message without a 'type' field:", message);
                 }

            } catch (e) {
                console.error("Failed to parse WebSocket message:", event.data, e);
            }
        };
    }

    connectWebSocket(); // Initial connection attempt on component mount

    // Cleanup function on component unmount
    return () => {
      if (connectIntervalRef.current) {
          clearTimeout(connectIntervalRef.current); // Use clearTimeout
          connectIntervalRef.current = null;
      }
      // Use the wsClient state variable for cleanup ensures we close the *correct* instance
      if (wsClient) {
        console.log('Closing WebSocket connection on App unmount.');
        wsClient.onclose = null; // Prevent reconnect logic during intentional close
        wsClient.onerror = null;
        wsClient.onmessage = null;
        wsClient.onopen = null;
        wsClient.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array: run only once on mount

  return (
    <KBarProvider>
      <div className="app-container flex h-screen bg-gray-100 dark:bg-gray-900">
        {/* Sidebar */}
        <nav className="sidebar w-[var(--sidebar-width)] bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4 flex flex-col overflow-y-auto flex-shrink-0">
          <Sidebar />
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
            <Route path="/chat" element={<Chat />} />
            <Route path="/chattest" element={<div className="bg-pink-600 w-full h-full flex items-center justify-center text-white text-3xl font-bold">THIS IS A TEST ROUTE WITH PINK BACKGROUND</div>} />
            {/* Add other routes as needed */}
          </Routes>
        </main>

        {/* Activity Feed */}
        <aside className="activity-feed w-[var(--feed-width)] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
           <ActivityFeed initialItems={activityItems} /> {/* Pass centrally managed items */}
           {/* Announcer for screen readers */}
           <div className="sr-only" aria-live="polite" id="activity-announcer"></div>
        </aside>

        {/* Command Palette (Portal) */}
        <CommandPalette />
      </div>
    </KBarProvider>
  );
}

export default App;