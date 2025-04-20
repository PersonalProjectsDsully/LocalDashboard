import React, { useState } from "react";

// Dummy data for chats and models
const mockChats = [
  { id: "1", title: "Welcome Chat" },
  { id: "2", title: "Project Discussion" },
];
const models = ["gpt-4", "gpt-3.5-turbo"];

const Chat: React.FC = () => {
  const [selectedChat, setSelectedChat] = useState<string | null>(mockChats[0]?.id ?? null);
  const [temperature, setTemperature] = useState(0.7);
  const [contextLength, setContextLength] = useState(10);
  const [model, setModel] = useState(models[0]);
  const [messages, setMessages] = useState<any[]>([]);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* LEFT SIDEBAR - Conversations */}
      <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold">Conversations</span>
            <button
              className="bg-blue-600 px-2 py-0.5 rounded text-xs"
              onClick={() => {
                const id = (Math.random() + 1).toString(36).substring(7);
                setSelectedChat(id);
                mockChats.push({ id, title: `Chat ${mockChats.length + 1}` });
              }}
            >
              + New
            </button>
          </div>
          <div className="space-y-2">
            {mockChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => setSelectedChat(chat.id)}
                className={`cursor-pointer px-2 py-1 rounded ${
                  selectedChat === chat.id ? "bg-blue-700" : "hover:bg-gray-700"
                }`}
              >
                {chat.title}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* MAIN CHAT AREA */}
      <main className="flex-1 flex flex-col border-r border-gray-800">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-gray-500 text-center mt-12 italic">
              No messages yet. Start chatting!
            </div>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-lg px-4 py-2 rounded-xl ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-100 border border-gray-700"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>
        {/* Chat input */}
        <form
          className="flex border-t border-gray-800 bg-gray-900 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.target as typeof e.target & { message: { value: string } };
            const text = form.message.value.trim();
            if (!text) return;
            setMessages([
              ...messages,
              { content: text, role: "user" },
              { content: "This is a mock assistant reply.", role: "assistant" }
            ]);
            form.message.value = "";
          }}
        >
          <input
            className="flex-1 rounded bg-gray-800 px-3 py-2 text-gray-100 border border-gray-700 focus:outline-none"
            name="message"
            autoComplete="off"
            placeholder="Type your message..."
          />
          <button
            type="submit"
            className="ml-2 bg-blue-700 rounded px-4 py-2 text-white font-semibold hover:bg-blue-800"
          >
            Send
          </button>
        </form>
      </main>

      {/* RIGHT SIDEBAR - Model settings */}
      <aside className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <span className="font-bold">Model Settings</span>
        </div>
        <div className="p-4 space-y-6">
          <div>
            <div className="text-xs mb-1">Model</div>
            <select
              className="w-full bg-gray-900 border border-gray-700 text-gray-100 rounded px-2 py-1"
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs mb-1">
              Temperature: <span className="font-mono">{temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0" max="1" step="0.01"
              value={temperature}
              onChange={e => setTemperature(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <div className="text-xs mb-1">
              Context Length: <span className="font-mono">{contextLength}</span>
            </div>
            <input
              type="range"
              min="1" max="50" step="1"
              value={contextLength}
              onChange={e => setContextLength(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </aside>
    </div>
  );
};

export default Chat;
