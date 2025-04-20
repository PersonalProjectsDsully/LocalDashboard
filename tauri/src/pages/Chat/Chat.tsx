// src/pages/Chat/Chat.tsx

import React, { FormEvent, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// Import rehype-highlight for automatic highlighting with highlight.js
import rehypeHighlight from 'rehype-highlight';
// Note: Ensure you have imported a highlight.js CSS theme in your main CSS file (e.g., index.css)
// Example: @import 'highlight.js/styles/github-dark.css';
import axios from 'axios';
import { format } from 'date-fns';
import { Send, Loader2 } from 'lucide-react';
import { eventBus } from '../../App'; // Import event bus
import { v4 as uuidv4 } from 'uuid'; // For unique message IDs

// --- Types ---
export interface Message {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: string; // Use string for ISO format consistency
  model?: string; // Optional: Which model generated the response
}

export interface ChatMeta {
  id: string;
  title: string;
  created_at?: number; // Optional - keep if needed from your structure
  lastMessage?: string; // Keep for display in sidebar
  lastUpdated?: string; // Keep for display/sorting in sidebar
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

// --- Props Interface ---
interface ChatProps {
  selectedChatId: string | null;
  selectedModelId: string;
  models: Model[];
  onSessionUpdate: (updatedSession: ChatMeta) => void; // Callback to update title/last message in parent
  setChatError: (error: string | null) => void; // Allow Chat to set errors in App
  chatError: string | null; // Receive error state from parent
}

// ------------ UI Components ------------
const ChatBubble: React.FC<{ msg: Message }> = ({ msg }) => {
  // No custom components needed for basic highlighting with rehype-highlight
  // unless you want further customization.

  return (
      <div
          className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} group`}
      >
          <div
              className={`relative max-w-xl md:max-w-2xl lg:max-w-3xl px-4 py-2.5 rounded-xl prose dark:prose-invert prose-sm break-words ${
                  msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : msg.role === "assistant"
                  ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700"
                  : "bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-600 text-yellow-800 dark:text-yellow-100" // System message style
              }`}
          >
              {/* Use components prop for custom rendering including code blocks */}
              <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]} // Add rehypeHighlight here
              >
                  {msg.content}
              </ReactMarkdown>
          </div>
          <div className={`mt-1 text-xs text-gray-400 dark:text-gray-500 px-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                {/* Ensure timestamp is valid before formatting */}
                {msg.timestamp && !isNaN(new Date(msg.timestamp).getTime())
                    ? format(new Date(msg.timestamp), 'h:mm a')
                    : 'Invalid date'}
                {msg.model && ` (via ${msg.model})`}
          </div>
      </div>
  );
};


// ------------ Main component ------------
const Chat: React.FC<ChatProps> = ({
    selectedChatId,
    selectedModelId,
    models,
    onSessionUpdate,
    setChatError,
    chatError // Receive error state from parent
}) => {
  // --- Local state for this chat instance
  const [currentChatDetails, setCurrentChatDetails] = useState<{title: string, messages: Message[]} | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false); // Loading state for message response
  const [isFetchingMessages, setIsFetchingMessages] = useState(false); // Separate loading state for fetching messages
  const [forceUpdateKey, setForceUpdateKey] = useState(0); // Force rerender key
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // --- Fetch Messages for Selected Chat ---
  const fetchMessages = useCallback(async (chatId: string | null) => {
      if (!chatId) {
          setCurrentChatDetails(null);
          setIsFetchingMessages(false);
          return;
      }
      setIsFetchingMessages(true);
      setChatError(null); // Clear parent error on new fetch attempt
      try {
          const response = await axios.get(`http://localhost:8000/chat/sessions/${chatId}`);
          if (response.data) {
              setCurrentChatDetails({
                  title: response.data.title || "Chat",
                  // Ensure messages array exists and has valid timestamps before setting state
                  messages: (response.data.messages || []).filter((m: Message) => m && m.timestamp)
              });
          } else {
               setCurrentChatDetails({ title: "Chat", messages: [] });
          }
      } catch (err) {
          console.error(`Failed to fetch messages for session ${chatId}:`, err);
          setChatError(`Failed to load messages for this chat.`); // Set parent error
          setCurrentChatDetails(null);
      } finally {
          setIsFetchingMessages(false);
      }
  }, [setChatError]);

  // --- Effects ---
  useEffect(() => {
      fetchMessages(selectedChatId);
  }, [selectedChatId, fetchMessages]);

  // Force UI update when messages change
  useEffect(() => {
    if (currentChatDetails?.messages?.length > 0) {
      console.log(`Messages array changed, length: ${currentChatDetails.messages.length}`);
      // Force scrolling to bottom on message change
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentChatDetails?.messages]);

  // --- WebSocket Listener ---
  useEffect(() => {
       console.log('Setting up WebSocket listener for chat messages, current chat ID:', selectedChatId);
       const handleMessageReceived = (wsMessage: any) => {
           console.log(`WebSocket message received in Chat component:`, wsMessage);
           if (wsMessage.type === 'chat_message_received' && wsMessage.session_id === selectedChatId && wsMessage.message) {
               console.log(`WS: Received message for current chat ${selectedChatId}`);
                setCurrentChatDetails(prev => {
                    if (!prev) return prev;
                    if (prev.messages.some(m => m.id === wsMessage.message.id)) {
                        console.log('Message already exists in state, not adding duplicate');
                        return prev;
                    }
                    // Add validation for received message
                    if (!wsMessage.message.id || !wsMessage.message.content || !wsMessage.message.timestamp) {
                        console.warn("WS: Received invalid message structure", wsMessage.message);
                        return prev;
                    }
                    const updatedState = { ...prev, messages: [...prev.messages, wsMessage.message] };
                    console.log('Updating chat state with new message:', wsMessage.message.content.substring(0, 50));
                    // Force a rerender by incrementing the key
                    setTimeout(() => setForceUpdateKey(prev => prev + 1), 10);
                    return updatedState;
                });
                // Use received message for update callback
                onSessionUpdate({
                    id: selectedChatId, 
                    title: currentChatDetails?.title || "Chat",
                    lastMessage: wsMessage.message.content.substring(0, 50) + (wsMessage.message.content.length > 50 ? '...' : ''),
                    lastUpdated: new Date().toISOString()
                 });
           } else if (wsMessage.type === 'chat_session_updated' && wsMessage.session_id === selectedChatId) {
                 // Refetch if the whole session data is updated (e.g., title change from backend)
                 console.log(`WS: Session ${selectedChatId} data updated externally, refetching messages...`);
                 fetchMessages(selectedChatId);
           }
       };
       
       // Clear any existing listeners first to prevent duplicates
       eventBus.off('chat_message_received', handleMessageReceived);
       eventBus.off('chat_session_updated', handleMessageReceived);
       
       // Add new listeners
       const unsubMessage = eventBus.on('chat_message_received', handleMessageReceived);
       const unsubSession = eventBus.on('chat_session_updated', handleMessageReceived);
       
       return () => { 
           console.log('Cleaning up WebSocket listeners');
           unsubMessage(); 
           unsubSession(); 
       };
  }, [selectedChatId, fetchMessages, currentChatDetails?.title, onSessionUpdate]);

  // --- Send Message Handler ---
  const sendMessage = useCallback(async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!message.trim() || !selectedChatId || !selectedModelId) return;
    setChatError(null);

    const userMessage: Message = {
      id: uuidv4(), role: "user", content: message, timestamp: new Date().toISOString(),
    };

    // Update local state immediately
    setCurrentChatDetails(prev => prev ? { ...prev, messages: [...prev.messages, userMessage] } : { title: "Chat", messages: [userMessage] });
    const messageToSend = message;
    setMessage(''); // Clear input
    setLoading(true); // Start loading spinner

    // Auto-scroll after adding user message
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);

    try {
      console.log(`Sending message to ${selectedModelId} for chat ${selectedChatId}`);
      const response = await axios.post('http://localhost:8000/chat/message', {
        message: messageToSend, 
        model_id: selectedModelId, 
        session_id: selectedChatId,
      });

      console.log(`Received response from API:`, response.data);

      // Update session title in parent if backend changed it
      if (response.data && response.data.session && response.data.session.title && response.data.session.title !== currentChatDetails?.title) {
        setCurrentChatDetails(prev => prev ? { ...prev, title: response.data.session.title } : null);
        onSessionUpdate({ id: selectedChatId, title: response.data.session.title });
      }

      // If we received the assistant's message directly in the response,
      // update the UI immediately without waiting for the WebSocket
      if (response.data && response.data.assistant_message) {
        const assistantMessage = response.data.assistant_message;
        console.log('Received assistant message directly in response:', assistantMessage.content.substring(0, 50));
        
        // IMPORTANT: Force update the UI with the message from the HTTP response
        // This ensures we see the message even if WebSocket fails
        setCurrentChatDetails(prev => {
          if (!prev) return prev;
          
          // Check if the message already exists (avoid duplicates)
          if (prev.messages.some(m => m.id === assistantMessage.id)) {
            return prev;
          }
          
          // Create a new messages array with the assistant message added
          const updatedMessages = [...prev.messages, assistantMessage];
          console.log(`Forcing update with assistant message. Messages count: ${updatedMessages.length}`);
          
          // Create a completely new state object to ensure React detects the change
          return {
            ...prev,
            messages: updatedMessages,
            // Update these fields to match what the server would set
            lastMessage: "Response from assistant",
            lastUpdated: new Date().toISOString()
          };
        });
        
        // Also update the parent component's state
        onSessionUpdate({
          id: selectedChatId,
          title: currentChatDetails?.title || "Chat",
          lastMessage: assistantMessage.content.substring(0, 50) + 
            (assistantMessage.content.length > 50 ? '...' : ''),
          lastUpdated: new Date().toISOString()
        });
        
        // Force scroll to bottom
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      }

    } catch (err) {
      console.error('Failed to get response from LLM:', err);
      setChatError('Failed to get response from the assistant. Please try again.');
      // Show error message in chat
      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        role: "assistant",
        content: "Error: Unable to get a response from the model. Please try again.",
        timestamp: new Date().toISOString(),
      };
      setCurrentChatDetails(prev => prev ? { ...prev, messages: [...prev.messages, errorMessage] } : null);
    } finally {
      setLoading(false); // Stop loading spinner
      // Ensure we scroll to the bottom again after response is added
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [message, selectedChatId, selectedModelId, currentChatDetails?.title, setChatError, onSessionUpdate]);


  // --- KeyDown Handler ---
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (message.trim() && !loading) {
        sendMessage(); // Call the memoized sendMessage
      }
    }
  };

  const selectedModelName = models.find(m => m.id === selectedModelId)?.name || selectedModelId;

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" key={`chat-container-${forceUpdateKey}`}>
      {/* Chat Header */}
      <div className="chat-header px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0">
        <h2 className="text-lg font-medium truncate" title={currentChatDetails?.title}>
          {currentChatDetails?.title || (selectedChatId ? 'Loading...' : 'Select a Chat')}
        </h2>
        <div className="text-xs text-gray-500 dark:text-gray-400">
           Using model: {selectedModelName}
        </div>
      </div>

      {/* Messages Container */}
      <div className="messages-container flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        {isFetchingMessages ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-10">Loading messages...</div>
        ) : currentChatDetails?.messages && currentChatDetails.messages.length > 0 ? (
          currentChatDetails.messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
        ) : selectedChatId ? (
           <div className="text-center text-gray-500 dark:text-gray-400 mt-12 italic">
             No messages yet. Start chatting with {selectedModelName}!
           </div>
        ) : (
             <div className="text-center text-gray-500 dark:text-gray-400 mt-12 italic">
                Select or create a chat session to begin.
             </div>
        )}
        {/* Loader at the bottom when waiting for assistant */}
        {loading ? (
             <div className="flex justify-start pl-12"> {/* Align with assistant bubble */}
                 <div className="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2.5 rounded-xl inline-flex items-center gap-2">
                     <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                     <span className="text-sm text-gray-500 dark:text-gray-400">Thinking...</span>
                 </div>
            </div>
        ) : null} {/* Use ternary operator */}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="input-area p-3 md:p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Error Display */}
        {chatError && !chatError.includes('messages') && <div className="text-xs text-red-500 dark:text-red-400 mb-2 text-center">{chatError}</div>}
        <form onSubmit={sendMessage} className="flex items-end gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${selectedModelName}... (Shift+Enter for newline)`}
            className="flex-1 p-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm"
            rows={1}
             style={{ maxHeight: '120px', overflowY: 'auto' }}
             onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
             }}
            disabled={loading || isFetchingMessages || !selectedChatId}
          />
          <button
            type="submit"
            className={`p-3 text-white rounded-lg flex items-center justify-center transition-colors ${
              loading || isFetchingMessages || !message.trim() || !selectedChatId
                ? "bg-gray-400 dark:bg-gray-600 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            }`}
            disabled={loading || isFetchingMessages || !message.trim() || !selectedChatId}
            title="Send message"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send size={20} />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Chat;