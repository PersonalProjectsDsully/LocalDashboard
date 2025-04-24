import React from 'react';

const ChatTest: React.FC = () => {
  return (
    <div className="bg-red-500 h-full w-full flex flex-col items-center justify-center text-white">
      <h1 className="text-4xl font-bold mb-4">TEST COMPONENT</h1>
      <p>This is a test component with a bright red background to check if component changes are being applied.</p>
      <button className="mt-4 bg-white text-red-500 px-4 py-2 rounded-lg font-bold">
        Test Button
      </button>
    </div>
  );
};

export default ChatTest;
