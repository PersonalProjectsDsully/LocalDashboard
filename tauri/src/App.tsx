import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { KBarProvider } from 'kbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Documents from './pages/Documents';
import Tasks from './pages/Tasks';
import CommandPalette from './components/CommandPalette';
import ActivityFeed from './components/ActivityFeed';
import './styles/App.css';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [wsClient, setWsClient] = useState<WebSocket | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws');
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setWsClient(ws);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setWsClient(null);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message:', data);
      // Handle different message types here
    };
    
    return () => {
      ws.close();
    };
  }, []);

  return (
    <KBarProvider>
      <div className="app-container">
        <nav className="sidebar">
          <Sidebar />
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/tasks" element={<Tasks />} />
          </Routes>
        </main>
        <aside className="activity-feed" aria-live="polite">
          <ActivityFeed />
          <div className="sr-only" aria-live="assertive" id="activity-announcer"></div>
        </aside>
        <CommandPalette />
      </div>
    </KBarProvider>
  );
}

export default App;
