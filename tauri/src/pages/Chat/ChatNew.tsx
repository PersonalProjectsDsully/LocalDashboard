import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { format } from 'date-fns';

// Define the message interface
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
}

// Define the chat session interface
interface ChatSession {
  id: string;
  title: string;
  lastMessage: string;
  lastUpdated: string;
  messages: Message[];
}

// Define the model interface
interface Model {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

const ChatNew: React.FC = () => {
  // State for chat sessions, messages, models
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Fetch chat sessions on component mount
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        // Try to fetch sessions from the backend
        const response = await axios.get('http://localhost:8000/chat/sessions');
        if (response.data && response.data.length > 0) {
          setChatSessions(response.data);
          setCurrentSession(response.data[0]);
        } else {
          // Create a default session if none exist
          createNewSession();
        }
      } catch (err) {
        console.error('Failed to fetch chat sessions:', err);
        // For local storage fallback if backend is unavailable
        const storedSessions = localStorage.getItem('chatSessions');
        if (storedSessions) {
          const parsedSessions = JSON.parse(storedSessions) as ChatSession[];
          setChatSessions(parsedSessions);
          setCurrentSession(parsedSessions[0]);
        } else {
          createNewSession();
        }
      }
    };

    const fetchModels = async () => {
      try {
        // Try to fetch models from the backend
        const response = await axios.get('http://localhost:8000/chat/models');
        if (response.data && response.data.length > 0) {
          setModels(response.data);
          setSelectedModel(response.data[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch chat models:', err);
        // Fallback to hardcoded models
        const mockModels: Model[] = [
          { id: 'llama3', name: 'Llama 3 8B', provider: 'ollama', description: 'Meta\'s Llama 3 8B model' },
          { id: 'llama3-70b', name: 'Llama 3 70B', provider: 'ollama', description: 'Meta\'s Llama 3 70B model' },
          { id: 'mistral', name: 'Mistral 7B', provider: 'ollama', description: 'Mistral AI\'s 7B model' },
          { id: 'claude', name: 'Claude', provider: 'anthropic', description: 'Anthropic\'s Claude model' }
        ];
        setModels(mockModels);
        setSelectedModel(mockModels[0].id);
      }
    };
    
    fetchSessions();
    fetchModels();
  }, []);
  
  // Scroll to bottom of messages when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);
  
  // Create a new chat session
  const createNewSession = async () => {
    const sessionId = Date.now().toString();
    const newSession: ChatSession = {
      id: sessionId,
      title: 'New Chat',
      lastMessage: 'No messages yet',
      lastUpdated: new Date().toISOString(),
      messages: []
    };
    
    try {
      // Try to save to backend
      await axios.post('http://localhost:8000/chat/sessions', newSession);
      
      // Update local state
      setChatSessions(prev => [newSession, ...prev]);
      setCurrentSession(newSession);
    } catch (err) {
      console.error('Failed to create chat session on backend:', err);
      // Fallback to local storage
      const updatedSessions = [newSession, ...chatSessions];
      setChatSessions(updatedSessions);
      setCurrentSession(newSession);
      localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
    }
  };
  
  // Send a message to the LLM
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!message.trim() || !currentSession || !selectedModel) return;
    
    // Create new message object
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    
    // Copy the current session to avoid direct state modification
    const currentSessionCopy = { ...currentSession };
    const updatedMessages = [...(currentSessionCopy.messages || []), userMessage];
    
    // Update the session with the new message
    currentSessionCopy.messages = updatedMessages;
    currentSessionCopy.lastMessage = message;
    currentSessionCopy.lastUpdated = new Date().toISOString();
    
    // Update UI optimistically
    setCurrentSession(currentSessionCopy);
    setMessage('');
    setLoading(true);
    
    try {
      // Send the message to the backend
      const response = await axios.post('http://localhost:8000/chat/message', {
        message: message,
        model_id: selectedModel,
        session_id: currentSession.id
      });
      
      // Update with the response from the backend
      if (response.data && response.data.session) {
        setCurrentSession(response.data.session);
        // Update the session in the list
        setChatSessions(prev => 
          prev.map(s => s.id === currentSession.id ? response.data.session : s)
        );
      }
    } catch (err) {
      console.error('Failed to get response from LLM:', err);
      setError('Failed to get response from the assistant. Please try again.');
      
      // Fallback to local mock response
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `This is a mock response as the backend is unavailable. The actual implementation would connect to the LLM API.`,
        timestamp: new Date().toISOString(),
        model: models.find(m => m.id === selectedModel)?.name || selectedModel
      };
      
      // Update the session with the assistant's response
      currentSessionCopy.messages.push(assistantMessage);
      currentSessionCopy.lastMessage = 'Response from assistant';
      currentSessionCopy.lastUpdated = new Date().toISOString();
      
      setCurrentSession(currentSessionCopy);
      
      // Update the session in the sessions list
      const updatedSessions = chatSessions.map(s => 
        s.id === currentSession.id ? currentSessionCopy : s
      );
      setChatSessions(updatedSessions);
      
      // Save to localStorage as fallback
      localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
    } finally {
      setLoading(false);
    }
  };
  
  // Switch to a different chat session
  const switchSession = async (sessionId: string) => {
    // If we're already on this session, do nothing
    if (currentSession?.id === sessionId) return;
    
    try {
      // Try to fetch the session from the backend
      const response = await axios.get(`http://localhost:8000/chat/sessions/${sessionId}`);
      if (response.data) {
        setCurrentSession(response.data);
      }
    } catch (err) {
      console.error(`Failed to fetch session ${sessionId}:`, err);
      // Fallback to local state
      const session = chatSessions.find(s => s.id === sessionId);
      if (session) {
        setCurrentSession(session);
      }
    }
  };
  
  // Delete a chat session
  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering switchSession
    
    try {
      // Try to delete from backend
      await axios.delete(`http://localhost:8000/chat/sessions/${sessionId}`);
      
      // Update local state
      const updatedSessions = chatSessions.filter(s => s.id !== sessionId);
      setChatSessions(updatedSessions);
      
      // If we deleted the current session, switch to another one
      if (currentSession?.id === sessionId) {
        setCurrentSession(updatedSessions.length > 0 ? updatedSessions[0] : null);
      }
      
      // If we deleted all sessions, create a new one
      if (updatedSessions.length === 0) {
        createNewSession();
      }
    } catch (err) {
      console.error(`Failed to delete session ${sessionId}:`, err);
      // Fallback to local state update
      const updatedSessions = chatSessions.filter(s => s.id !== sessionId);
      setChatSessions(updatedSessions);
      
      if (currentSession?.id === sessionId) {
        setCurrentSession(updatedSessions.length > 0 ? updatedSessions[0] : null);
      }
      
      if (updatedSessions.length === 0) {
        createNewSession();
      }
      
      // Update localStorage
      localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
    }
  };
  
  // Handle keydown events for the textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If Enter is pressed without Shift, submit the form
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (message.trim()) {
        try {
          sendMessage(e as unknown as React.FormEvent);
        } catch (err) {
          console.error('Error sending message:', err);
          setError('Failed to send message. Please try again.');
        }
      }
    }
  };
  
  return (
    <div className="bg-red-600 text-white h-full flex">
      {/* Sidebar - left column */}
      <div className="w-64 bg-black flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-2xl font-bold mb-2">CHAT TEST</h1>
          <button 
            className="w-full bg-green-500 text-white py-2 rounded-lg"
            onClick={createNewSession}
          >
            New Chat
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
          {chatSessions.map(session => (
            <div 
              key={session.id}
              className={`p-2 rounded my-1 cursor-pointer ${
                currentSession?.id === session.id ? 'bg-green-500' : 'bg-gray-700'
              }`}
              onClick={() => switchSession(session.id)}
            >
              {session.title}
            </div>
          ))}
        </div>
        
        <div className="p-4 bg-gray-800">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full p-2 bg-black text-white border border-gray-700 rounded"
          >
            {models.map(model => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        </div>
      </div>
      
      {/* Main content - right column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-yellow-500 p-4 text-black font-bold">
          THIS IS A TEST COMPONENT TO CHECK UPDATES
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {currentSession?.messages.map(msg => (
            <div 
              key={msg.id}
              className={`my-2 p-3 rounded max-w-md ${
                msg.role === 'user' ? 'ml-auto bg-green-500' : 'mr-auto bg-blue-500'
              }`}
            >
              {msg.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        
        <div className="p-4 bg-gray-800">
          <form onSubmit={sendMessage} className="flex">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 p-2 bg-black text-white border border-gray-700 rounded-l"
              rows={3}
            />
            <button
              type="submit"
              className="px-4 bg-green-500 text-white rounded-r"
              disabled={loading}
            >
              {loading ? '...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatNew;