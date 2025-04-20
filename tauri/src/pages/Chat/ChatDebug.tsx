import React from 'react';

const ChatDebug: React.FC = () => {
  return (
    <div className="flex h-screen bg-red-100">
      <aside className="w-64 bg-blue-200 p-4 border">Left Sidebar</aside>
      <main className="flex-1 bg-green-200 p-4 border">Main Chat Area</main>
      <aside className="w-64 bg-yellow-200 p-4 border">Right Sidebar</aside>
    </div>
  );
};

export default ChatDebug;
