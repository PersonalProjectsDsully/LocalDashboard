// src/pages/Chat/Chat.tsx

import React, { FormEvent, useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import axios from 'axios';
import { format } from 'date-fns';
import { Send, Loader2, ThumbsUp, ThumbsDown, Copy, RotateCcw, RefreshCw, Share, MessageSquare } from 'lucide-react';
import { eventBus } from '../../App'; // Import event bus
import { v4 as uuidv4 } from 'uuid'; // For unique message IDs
import './Chat.css'; // Import CSS

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

// Workspace context interface is kept for the props
export interface WorkspaceContext {
  includeProjects: boolean;
  includeTasks: boolean;
  includeDocuments: boolean;
  includeDocumentContent: boolean;
}

// --- Props Interface ---
interface ChatProps {
  selectedChatId: string | null;
  selectedModelId: string;
  models: Model[];
  onSessionUpdate: (updatedSession: ChatMeta) => void; // Callback to update title/last message in parent
  setChatError: (error: string | null) => void; // Allow Chat to set errors in App
  chatError: string | null; // Receive error state from parent
  // Workspace context props
  workspaceContext: WorkspaceContext;
  setWorkspaceContext: React.Dispatch<React.SetStateAction<WorkspaceContext>>;
}

// ------------ UI Components ------------
const ChatBubble: React.FC<{ msg: Message }> = ({ msg }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`message-container ${msg.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
      <div className="flex flex-col max-w-[80%]">
        <div
          className={`${
            msg.role === "user"
              ? "user-message"
              : "assistant-message"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {msg.content}
          </ReactMarkdown>
        </div>
        
        {/* Reaction buttons */}
        <div className={`message-reactions ${msg.role === "assistant" ? "assistant-reactions" : ""}`}>
          {msg.role === "assistant" && (
            <>
              <button className="reaction-button" title="Like">
                <ThumbsUp size={16} />
              </button>
              <button className="reaction-button" title="Dislike">
                <ThumbsDown size={16} />
              </button>
              <button className="reaction-button" title={copied ? "Copied!" : "Copy to clipboard"} onClick={copyToClipboard}>
                <Copy size={16} />
              </button>
              <button className="reaction-button" title="Regenerate">
                <RefreshCw size={16} />
              </button>
              <button className="reaction-button" title="Share">
                <Share size={16} />
              </button>
            </>
          )}
          {msg.role === "user" && (
            <>
              <button className="reaction-button" title={copied ? "Copied!" : "Copy to clipboard"} onClick={copyToClipboard}>
                <Copy size={16} />
              </button>
              <button className="reaction-button" title="Edit">
                <span className="font-medium">Edit</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Typing indicator component
const TypingIndicator: React.FC = () => {
  return (
    <div className="typing-indicator">
      <div className="dot"></div>
      <div className="dot"></div>
      <div className="dot"></div>
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
  chatError,
  // Workspace context props
  workspaceContext
}) => {
  // --- Local state for this chat instance
  const [currentChatDetails, setCurrentChatDetails] = useState<{ title: string; messages: Message[] } | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false); // Loading state for message response
  const [isFetchingMessages, setIsFetchingMessages] = useState(false); // Separate loading state for fetching messages
  const [forceUpdateKey, setForceUpdateKey] = useState(0); // Force rerender key
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // --- Fetch Messages for Selected Chat ---
  const fetchMessages = useCallback(
    async (chatId: string | null) => {
      if (!chatId) {
        setCurrentChatDetails(null);
        setIsFetchingMessages(false);
        return;
      }
      setIsFetchingMessages(true);
      setChatError(null); // Clear parent error on new fetch attempt
      try {
        // First try the backend API
        try {
          const response = await axios.get(`http://localhost:8000/chat/sessions/${chatId}`);
          if (response.data) {
            setCurrentChatDetails({
              title: response.data.title || 'Chat',
              // Ensure messages array exists and has valid timestamps before setting state
              messages: (response.data.messages || []).filter((m: Message) => m && m.timestamp),
            });
            setIsFetchingMessages(false);
            return;
          }
        } catch (apiError) {
          console.warn(`Backend API unavailable, trying localStorage for chat ${chatId}:`, apiError);
        }

        // If backend fails, try to load from localStorage
        try {
          const savedMessages = localStorage.getItem(`chat_messages_${chatId}`);
          if (savedMessages) {
            const parsedMessages = JSON.parse(savedMessages);
            if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
              console.log(`Loaded ${parsedMessages.length} messages from localStorage for chat ${chatId}`);

              // Find the chat title from the sessions list
              const chatSession = JSON.parse(localStorage.getItem('chatSessions') || '[]').find(
                (s: ChatMeta) => s.id === chatId
              );

              setCurrentChatDetails({
                title: chatSession?.title || 'Chat',
                messages: parsedMessages.filter((m: Message) => m && m.timestamp),
              });
              setIsFetchingMessages(false);
              return;
            }
          }
          // If no messages in localStorage, create an empty chat
          setCurrentChatDetails({ title: 'Chat', messages: [] });
        } catch (storageErr) {
          console.error(`Error accessing localStorage for chat ${chatId}:`, storageErr);
          setCurrentChatDetails({ title: 'Chat', messages: [] });
        }
      } catch (err) {
        console.error(`Failed to fetch messages for session ${chatId}:`, err);
        // Only show error message if it's not a 404 (which is expected when the backend is not running)
        if (axios.isAxiosError(err) && err.response?.status !== 404) {
          setChatError(`Failed to load messages for this chat.`); // Set parent error
        }
      } finally {
        setIsFetchingMessages(false);
      }
    },
    [setChatError]
  );

  // --- Effects ---
  useEffect(() => {
    fetchMessages(selectedChatId);
  }, [selectedChatId, fetchMessages]);

  // Force UI update when messages change and scroll to bottom
  useEffect(() => {
    if (currentChatDetails?.messages?.length > 0) {
      console.log(`Messages array changed, length: ${currentChatDetails.messages.length}`);
      // Force scrolling to bottom on message change
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentChatDetails?.messages]);

  // Store messages to localStorage when they change
  useEffect(() => {
    if (currentChatDetails?.messages && selectedChatId) {
      try {
        localStorage.setItem(`chat_messages_${selectedChatId}`, JSON.stringify(currentChatDetails.messages));
      } catch (e) {
        console.error('Failed to save messages to localStorage:', e);
      }
    }
  }, [currentChatDetails?.messages, selectedChatId]);

  // --- WebSocket Listener ---
  useEffect(() => {
    console.log('Setting up WebSocket listener for chat messages, current chat ID:', selectedChatId);
    const handleMessageReceived = (wsMessage: any) => {
      console.log(`WebSocket message received in Chat component:`, wsMessage);
      if (wsMessage.type === 'chat_message_received' && wsMessage.session_id === selectedChatId && wsMessage.message) {
        console.log(`WS: Received message for current chat ${selectedChatId}`);
        setCurrentChatDetails((prev) => {
          if (!prev) return prev;
          if (prev.messages.some((m) => m.id === wsMessage.message.id)) {
            console.log('Message already exists in state, not adding duplicate');
            return prev;
          }
          // Add validation for received message
          if (!wsMessage.message.id || !wsMessage.message.content || !wsMessage.message.timestamp) {
            console.warn('WS: Received invalid message structure', wsMessage.message);
            return prev;
          }
          const updatedState = { ...prev, messages: [...prev.messages, wsMessage.message] };
          console.log('Updating chat state with new message:', wsMessage.message.content.substring(0, 50));
          // Force a rerender by incrementing the key
          setTimeout(() => setForceUpdateKey((prev) => prev + 1), 10);
          return updatedState;
        });
        // Use received message for update callback
        onSessionUpdate({
          id: selectedChatId,
          title: currentChatDetails?.title || 'Chat',
          lastMessage:
            wsMessage.message.content.substring(0, 50) + (wsMessage.message.content.length > 50 ? '...' : ''),
          lastUpdated: new Date().toISOString(),
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

  // --- Send Message Handler (Modified for direct API interaction) ---
  const sendMessage = useCallback(
    async (e?: FormEvent<HTMLFormElement>) => {
      e?.preventDefault();
      if (!message.trim() || !selectedChatId || !selectedModelId) return;
      setChatError(null);

      const userMessage: Message = {
        id: uuidv4(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };

      // Update local state immediately
      setCurrentChatDetails((prev) =>
        prev ? { ...prev, messages: [...prev.messages, userMessage] } : { title: 'Chat', messages: [userMessage] }
      );
      const messageToSend = message;
      setMessage(''); // Clear input
      setLoading(true); // Start loading spinner
      
      // Reset textarea height
      if (textAreaRef.current) {
        textAreaRef.current.style.height = 'auto';
      }

      // Auto-scroll after adding user message
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);

      try {
        console.log(`Sending message to ${selectedModelId} for chat ${selectedChatId}`);

        // Create context_data object based on workspaceContext props
        const contextData = {
          include_projects: workspaceContext.includeProjects,
          include_tasks: workspaceContext.includeTasks,
          include_documents: workspaceContext.includeDocuments,
          include_document_content: workspaceContext.includeDocumentContent,
        };

        console.log('Including workspace context:', contextData);

        // FIXED: Use chat/completion endpoint directly
        const response = await axios.post('http://localhost:8000/chat/completion', {
          message: messageToSend,
          model_id: selectedModelId,
          session_id: selectedChatId,
          context_data: contextData,
        });

        console.log(`Received response from API:`, response.data);

        if (response.data) {
          // Create assistant message from response
          const assistantMessage: Message = {
            id: response.data.id || uuidv4(),
            role: 'assistant',
            content: response.data.content,
            timestamp: new Date().toISOString(),
            model: selectedModelId
          };

          console.log("Creating assistant message:", assistantMessage);

          // Update the chat with assistant's response
          setCurrentChatDetails((prev) => {
            if (!prev) return { title: 'Chat', messages: [userMessage, assistantMessage] };
            
            // Create a new array with the assistant message added
            const updatedMessages = [...prev.messages, assistantMessage];
            console.log(`Updating chat with assistant message. New message count: ${updatedMessages.length}`);
            
            return {
              ...prev,
              messages: updatedMessages
            };
          });

          // Update the parent component state
          onSessionUpdate({
            id: selectedChatId,
            title: currentChatDetails?.title || 'Chat',
            lastMessage: assistantMessage.content.substring(0, 50) + (assistantMessage.content.length > 50 ? '...' : ''),
            lastUpdated: new Date().toISOString(),
          });

          // Increment force update key to ensure UI refresh
          setForceUpdateKey(prev => prev + 1);
        }
      } catch (err) {
        console.error('Failed to get response from LLM:', err);
        setChatError('Failed to get response from the assistant. Please try again.');
        // Show error message in chat
        const errorMessage: Message = {
          id: `error_${Date.now()}`,
          role: 'assistant',
          content: 'Error: Unable to get a response from the model. Please try again.',
          timestamp: new Date().toISOString(),
        };
        setCurrentChatDetails((prev) => (prev ? { ...prev, messages: [...prev.messages, errorMessage] } : null));
      } finally {
        setLoading(false); // Stop loading spinner
        // Ensure we scroll to the bottom again after response is added
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          console.log("Scrolled to bottom after receiving response");
        }, 100);
      }
    },
    [
      message,
      selectedChatId,
      selectedModelId,
      workspaceContext,
      currentChatDetails?.title,
      setChatError,
      onSessionUpdate,
    ]
  );

  // --- KeyDown Handler ---
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (message.trim() && !loading) {
        sendMessage(); // Call the memoized sendMessage
      }
    }
  };

  // --- Auto-resize textarea ---
  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 150)}px`;
  };

  const selectedModelName = models.find((m) => m.id === selectedModelId)?.name || selectedModelId;

  return (
    <div
      className="chat-container"
      key={`chat-container-${forceUpdateKey}`}
    >
      {/* Messages Container */}
      <div className="messages-container flex-1 overflow-y-auto">
        {isFetchingMessages ? (
          <div className="flex flex-col items-center justify-center h-full py-10">
            <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 w-full max-w-md bg-blue-900/50 text-blue-300 font-medium">
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                <Loader2 size={16} className="animate-spin" />
              </div>
              <span className="truncate">Loading messages...</span>
            </button>
          </div>
        ) : currentChatDetails?.messages && currentChatDetails.messages.length > 0 ? (
          currentChatDetails.messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
        ) : selectedChatId ? (
          <div className="flex flex-col items-center justify-center h-full py-10">
            <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 w-full max-w-md bg-blue-900/50 text-blue-300 font-medium">
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                <MessageSquare size={16} />
              </div>
              <span className="truncate">No messages yet. Start chatting with {selectedModelName}!</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-10">
            <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 w-full max-w-md bg-blue-900/50 text-blue-300 font-medium">
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                <MessageSquare size={16} />
              </div>
              <span className="truncate">Select or create a chat session to begin.</span>
            </button>
          </div>
        )}
        {/* Typing indicator when waiting for assistant */}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="input-area">
        {/* Error Display */}
        {chatError && !chatError.includes('messages') && (
          <div className="text-xs text-red-400 mb-3 text-center">{chatError}</div>
        )}
        <form onSubmit={sendMessage}>
          <div className="input-container">
            <textarea
              ref={textAreaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleTextareaInput}
              placeholder={`Message ${selectedModelName}... (Shift+Enter for newline)`}
              className="input-textarea"
              rows={1}
              disabled={loading || isFetchingMessages || !selectedChatId}
            />
            <button
              type="submit"
              className="send-button"
              disabled={loading || isFetchingMessages || !message.trim() || !selectedChatId}
              title="Send message"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Chat;