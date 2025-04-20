// Chat.tsx – refined layout with single left sidebar & collapsible panel
// ---------------------------------------------------------------------------------
// Required runtime deps (already added previously):
//   react-markdown remark-gfm rehype-highlight highlight.js localforage uuid
// ---------------------------------------------------------------------------------

import React, { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import localforage from "localforage";
import { v4 as uuidv4 } from "uuid";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  MessageSquare,
  Settings as SettingsIcon,
} from "lucide-react";

// ------------ Types ------------
export interface Message {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  created_at: number;
}
export interface ChatMeta {
  id: string;
  title: string;
  created_at: number;
}

// ------------ Persist helpers ------------
const saveChats = async (chats: ChatMeta[]) => localforage.setItem("chats", chats);
const saveMsgs = async (chatId: string, msgs: Message[]) =>
  localforage.setItem(`chat-${chatId}`, msgs);
const loadChats = async (): Promise<ChatMeta[]> =>
  (await localforage.getItem<ChatMeta[]>("chats")) ?? [];
const loadMsgs = async (chatId: string): Promise<Message[]> =>
  (await localforage.getItem<Message[]>(`chat-${chatId}`)) ?? [];

// ------------ UI Components ------------
const ChatBubble: React.FC<{ msg: Message }> = ({ msg }) => (
  <div
    className={`max-w-lg px-4 py-2 rounded-xl prose dark:prose-invert break-words whitespace-pre-wrap ${
      msg.role === "user"
        ? "bg-blue-600 text-white ml-auto"
        : msg.role === "assistant"
        ? "bg-gray-800 border border-gray-700"
        : "bg-yellow-900/20 border border-yellow-600"
    }`}
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {msg.content}
    </ReactMarkdown>
  </div>
);

// ------------ Main component ------------
const Chat: React.FC = () => {
  // Data state
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Model settings
  const [model, setModel] = useState("gpt-4");
  const [temperature, setTemperature] = useState(0.7);
  const [contextLength, setContextLength] = useState(10);

  // UI state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedChatId]);

  // Initial load
  useEffect(() => {
    (async () => {
      const storedChats = await loadChats();
      setChats(storedChats);
      if (storedChats[0]) {
        setSelectedChatId(storedChats[0].id);
        setMessages(await loadMsgs(storedChats[0].id));
      }
    })();
  }, []);

  // Persist changes
  useEffect(() => {
    if (selectedChatId) saveMsgs(selectedChatId, messages);
  }, [messages, selectedChatId]);
  useEffect(() => {
    saveChats(chats);
  }, [chats]);

  // ---------- Handlers ----------
  const handleNewChat = () => {
    const id = uuidv4();
    const title = `Chat ${chats.length + 1}`;
    const newChat: ChatMeta = { id, title, created_at: Date.now() };
    setChats((prev) => [newChat, ...prev]);
    setSelectedChatId(id);
    setMessages([]);
  };
  const handleSelectChat = async (id: string) => {
    setSelectedChatId(id);
    setMessages(await loadMsgs(id));
  };

  // Fake streaming helper (replace with real API call)
  const streamAssistant = async (
    userText: string,
    assistantMsg: Message,
    chatId: string
  ) => {
    // TODO: integrate with backend
    const placeholder = `You said: ${userText}\n(Live streaming not wired yet)`;
    // Simulate typing effect
    for (let i = 1; i <= placeholder.length; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const slice = placeholder.slice(0, i);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: slice } : m))
      );
    }
  };

  const sendMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedChatId) return;
    const form = e.target as typeof e.target & { message: { value: string } };
    const text = form.message.value.trim();
    if (!text) return;

    const userMsg: Message = {
      id: uuidv4(),
      role: "user",
      content: text,
      created_at: Date.now(),
    };
    const assistantMsg: Message = {
      id: uuidv4(),
      role: "assistant",
      content: "",
      created_at: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    form.message.value = "";
    streamAssistant(text, assistantMsg, selectedChatId);
  };

  // ---------- Render ----------
  return (
    <div className="flex h-full bg-gray-900 text-gray-100">
      {/* Inner left sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? "w-14" : "w-72"
        } transition-all duration-200 flex flex-col border-r border-gray-800 bg-gray-850/80 backdrop-blur`}
      >
        {/* Header with toggle */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="p-1 rounded hover:bg-gray-700"
            title="Toggle sidebar"
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          {!sidebarCollapsed && <span className="font-semibold text-sm">Chats & Settings</span>}
        </div>

        {/* Content – scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* New Chat button */}
          {!sidebarCollapsed && (
            <button
              onClick={handleNewChat}
              className="flex items-center gap-1 text-sm w-full px-4 py-2 hover:bg-gray-800 border-b border-gray-800"
            >
              <Plus size={14} /> New Chat
            </button>
          )}

          {/* Chats list */}
          <nav className="mt-2 space-y-1 px-1">
            {chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className={`flex items-center gap-2 w-full truncate px-3 py-1.5 rounded text-left text-sm ${
                  selectedChatId === chat.id ? "bg-blue-700" : "hover:bg-gray-800"
                }`}
              >
                <MessageSquare size={16} />
                {!sidebarCollapsed && <span className="truncate">{chat.title}</span>}
              </button>
            ))}
            {chats.length === 0 && !sidebarCollapsed && (
              <p className="text-xs text-gray-500 px-4 py-4">No conversations yet.</p>
            )}
          </nav>

          {/* Divider */}
          <hr className="my-3 border-gray-800" />

          {/* Settings accordion */}
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="flex items-center gap-2 w-full px-4 py-2 hover:bg-gray-800 text-sm"
          >
            <SettingsIcon size={16} />
            {!sidebarCollapsed && (
              <span className="flex-1 text-left">Model Settings</span>
            )}
            {!sidebarCollapsed && (showSettings ? <ChevronLeft size={14} /> : <ChevronRight size={14} />)}
          </button>
          {showSettings && (
            <div className="space-y-6 px-4 pb-6 text-sm">
              {/* Model select */}
              <div>
                <label htmlFor="model" className="block text-xs mb-1">
                  Model
                </label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1"
                >
                  {["gpt-4", "gpt-3.5-turbo-0125", "mixtral-8x7b"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Temperature */}
              <div>
                <label htmlFor="temp" className="block text-xs mb-1">
                  Temperature: <span className="font-mono">{temperature.toFixed(2)}</span>
                </label>
                <input
                  id="temp"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Context length */}
              <div>
                <label htmlFor="ctx" className="block text-xs mb-1">
                  Context Length: <span className="font-mono">{contextLength}</span>
                </label>
                <input
                  id="ctx"
                  type="range"
                  min="1"
                  max="64"
                  step="1"
                  value={contextLength}
                  onChange={(e) => setContextLength(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main chat column */}
      <main className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <p className="text-gray-500 text-center mt-12 italic">
              No messages yet. Start chatting!
            </p>
          )}
          {messages.map((msg) => (
            <ChatBubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={sendMessage}
          className="flex gap-2 border-t border-gray-800 bg-gray-900 p-4"
        >
          <input
            name="message"
            placeholder="Type your message..."
            autoComplete="off"
            className="flex-1 rounded bg-gray-800 border border-gray-700 px-3 py-2 focus:outline-none"
          />
          <button
            type="submit"
            className="bg-blue-700 px-4 py-2 rounded font-semibold hover:bg-blue-800"
          >
            Send
          </button>
        </form>
      </main>
    </div>
  );
};

export default Chat;
