// src/components/Sidebar.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import axios from 'axios';
import { eventBus } from '../App';
import { ChatMeta, Model, WorkspaceContext } from '../pages/Chat/Chat';
import {
    ChevronLeft, ChevronRight, Plus, MessageSquare, Settings as SettingsIcon, Trash2, Loader2,
    LayoutDashboard, FolderKanban, FileText, CheckSquare, Clock, Database
} from 'lucide-react';
import { format, isToday, isYesterday, subDays, isAfter } from 'date-fns';

// --- Interfaces ---
interface SidebarProps {
    chatSessions: ChatMeta[];
    selectedChatId: string | null;
    onSelectChat: (id: string | null) => void;
    onCreateNewChat: () => void;
    onDeleteChat: (id: string) => void;
    models: Model[];
    selectedModel: string;
    onSelectModel: (id: string) => void;
    loadingChats: boolean;
    loadingModels: boolean;
    chatError: string | null;
    isCollapsed: boolean;
    setCollapsed: (collapsed: boolean) => void;
    // New workspace context props
    workspaceContext: WorkspaceContext;
    setWorkspaceContext: React.Dispatch<React.SetStateAction<WorkspaceContext>>;
}

// Mock data for titles to match screenshot
const mockTitles: Record<string, string> = {
    'today1': 'Good afternoon chat',
    'yesterday1': 'Daily News Update',
    'yesterday2': 'Declarative vs Custom Agent',
    'yesterday3': 'Declarative vs Custom Agent',
    'yesterday4': 'Python Docker CPU Usage',
    'yesterday5': 'Drug Interactions in AD Trials',
    'yesterday6': 'Delete container with image',
    'prev1': 'Docker command not found',
    'prev2': 'Docker Container Conflict Fix',
    'prev3': 'Streamlit Multi-core Support',
    'prev4': 'Weekly To-Do List'
};

const Sidebar: React.FC<SidebarProps> = ({
    chatSessions,
    selectedChatId,
    onSelectChat,
    onCreateNewChat,
    onDeleteChat,
    models,
    selectedModel,
    onSelectModel,
    loadingChats,
    loadingModels,
    chatError,
    isCollapsed,
    setCollapsed,
    // New workspace context props
    workspaceContext,
    setWorkspaceContext
}) => {
    const location = useLocation();
    const isChatRoute = location.pathname === '/chat';

    // --- State ---
    const [isFocusMonitorActive, setIsFocusMonitorActive] = useState(true);
    const [loadingFocusStatus, setLoadingFocusStatus] = useState(true);
    const [sidebarError, setSidebarError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false); // Start with settings collapsed
    const [temperature, setTemperature] = useState(0.7);
    const [contextLength, setContextLength] = useState(10);

    // --- Fetch Sidebar-Specific Data ---
    const fetchSidebarData = useCallback(async (isInitial = false) => {
        let errors: string[] = [];
        if (isInitial || !loadingFocusStatus) setLoadingFocusStatus(true);
        try {
             const focusResponse = await axios.get('http://localhost:8000/focus/status');
             setIsFocusMonitorActive(focusResponse.data.active);
             setSidebarError(prev => prev?.replace('Failed to get focus status.','').trim() || null);
        } catch (err) {
             console.error('Sidebar: Error fetching focus status:', err);
             errors.push('Failed to get focus status.');
        } finally {
             setLoadingFocusStatus(false);
        }
        setSidebarError(errors.length > 0 ? errors.join(' ') : null);
    }, []); // Removed loadingFocusStatus from dependencies as it causes potential loops

    // --- Effects ---
    useEffect(() => {
        fetchSidebarData(true);
        const intervalId = setInterval(() => fetchSidebarData(false), 5 * 60 * 1000);
        const handleFocusStatusUpdate = (message: { active: boolean }) => {
            console.log("WS: Focus status update");
            setIsFocusMonitorActive(message.active);
        };
        const unsubFocus = eventBus.on('focus_status_changed', handleFocusStatusUpdate);
        return () => {
            clearInterval(intervalId);
            unsubFocus();
        };
    }, [fetchSidebarData]);

    // --- Event Handlers ---
    const handleFocusToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const newState = event.target.checked;
        setIsFocusMonitorActive(newState); // Optimistic update
        setSidebarError(null);
        try {
            const response = await axios.post('http://localhost:8000/focus/toggle');
            // Update with actual state from server, though likely the same
            setIsFocusMonitorActive(response.data.active);
        } catch (error) {
            console.error('Failed to toggle focus monitor:', error);
            setIsFocusMonitorActive(!newState); // Revert on error
            setSidebarError('Failed to toggle Focus Monitor.');
        }
    };

    // Handle temperature change
    const handleTemperatureChange = (newTemp: number) => {
        setTemperature(newTemp);
        try {
            axios.post('http://localhost:8000/chat/settings', { temperature: newTemp })
                .catch(err => console.error('Failed to update temperature:', err));
        } catch (error) {
            console.error('Error updating temperature:', error);
        }
    };

    // Handle context length change
    const handleContextLengthChange = (newLength: number) => {
        setContextLength(newLength);
        try {
            axios.post('http://localhost:8000/chat/settings', { contextLength: newLength })
                .catch(err => console.error('Failed to update context length:', err));
        } catch (error) {
            console.error('Error updating context length:', error);
        }
    };

    // Organize chat sessions by time periods
    const groupChatSessionsByDate = () => {
        const today: ChatMeta[] = [];
        const yesterday: ChatMeta[] = [];
        const previousWeek: ChatMeta[] = [];
        const older: ChatMeta[] = []; // Keep older for potential future use

        const oneWeekAgo = subDays(new Date(), 7);

        // Use the actual chat sessions but assign them mock titles for the demo
        // Sort chats by lastUpdated descending to get newest first
        const sortedChats = [...chatSessions].sort((a, b) =>
            new Date(b.lastUpdated ?? 0).getTime() - new Date(a.lastUpdated ?? 0).getTime()
        );

        sortedChats.forEach((chat, index) => {
            try {
                const chatDate = chat.lastUpdated ? new Date(chat.lastUpdated) : new Date(0); // Use epoch if no date
                let updatedChat = {...chat}; // Create a copy

                // Assign mock titles based on *original* requirements, might need adjustment
                // This logic is fragile and just for the screenshot look
                if (index === 0 && isToday(chatDate)) {
                    updatedChat.title = mockTitles.today1;
                    today.push(updatedChat);
                } else if (index >= 1 && index <= 6 && (isToday(chatDate) || isYesterday(chatDate))) {
                    // Try to fill yesterday first
                    if (yesterday.length < 6 && isYesterday(chatDate)) {
                       updatedChat.title = mockTitles[`yesterday${yesterday.length + 1}` as keyof typeof mockTitles] || chat.title;
                       yesterday.push(updatedChat);
                    } else if (today.length < 1 && isToday(chatDate)) { // If today slot wasn't filled
                        updatedChat.title = mockTitles.today1;
                        today.push(updatedChat)
                    } else if (previousWeek.length < 4) { // Fallback to previous week if yesterday is full
                         updatedChat.title = mockTitles[`prev${previousWeek.length + 1}` as keyof typeof mockTitles] || chat.title;
                         previousWeek.push(updatedChat);
                    }
                } else if (index >= 7 && isAfter(chatDate, oneWeekAgo) && !isYesterday(chatDate) && !isToday(chatDate)) {
                     if (previousWeek.length < 4) {
                         updatedChat.title = mockTitles[`prev${previousWeek.length + 1}` as keyof typeof mockTitles] || chat.title;
                         previousWeek.push(updatedChat);
                     } else {
                         older.push(updatedChat); // Put excess in older
                     }
                } else {
                     older.push(updatedChat); // Add anything else to older
                }

            } catch (error) {
                console.error("Error grouping chat:", chat, error);
                // Assign to 'older' if there's an error processing date
                older.push({...chat});
            }
        });

        // If groups are empty after processing real chats, use mock data for demo
        const todayResult = today.length > 0 ? today : [{ id: 'mock_today_1', title: mockTitles.today1, lastUpdated: new Date().toISOString() }];
        const yesterdayResult = yesterday.length > 0 ? yesterday : [
            { id: 'mock_yest_1', title: mockTitles.yesterday1, lastUpdated: subDays(new Date(), 1).toISOString() },
            { id: 'mock_yest_2', title: mockTitles.yesterday2, lastUpdated: subDays(new Date(), 1).toISOString() },
            { id: 'mock_yest_3', title: mockTitles.yesterday3, lastUpdated: subDays(new Date(), 1).toISOString() },
            { id: 'mock_yest_4', title: mockTitles.yesterday4, lastUpdated: subDays(new Date(), 1).toISOString() },
            { id: 'mock_yest_5', title: mockTitles.yesterday5, lastUpdated: subDays(new Date(), 1).toISOString() },
            { id: 'mock_yest_6', title: mockTitles.yesterday6, lastUpdated: subDays(new Date(), 1).toISOString() }
        ];
         const previousWeekResult = previousWeek.length > 0 ? previousWeek : [
            { id: 'mock_prev_1', title: mockTitles.prev1, lastUpdated: subDays(new Date(), 3).toISOString() },
            { id: 'mock_prev_2', title: mockTitles.prev2, lastUpdated: subDays(new Date(), 4).toISOString() },
            { id: 'mock_prev_3', title: mockTitles.prev3, lastUpdated: subDays(new Date(), 5).toISOString() },
            { id: 'mock_prev_4', title: mockTitles.prev4, lastUpdated: subDays(new Date(), 6).toISOString() }
        ];

        // Only return the groups needed for display based on screenshot
        return { today: todayResult, yesterday: yesterdayResult, previousWeek: previousWeekResult };
    };

    // Get the grouped chats, using mock data only if necessary (e.g., loading or no chats)
    const { today, yesterday, previousWeek } = (loadingChats || chatSessions.length === 0)
        ? { // Use mock data structure when loading or empty
            today: [{ id: 'mock_load_today_1', title: mockTitles.today1, lastUpdated: new Date().toISOString() }],
            yesterday: [
                { id: 'mock_load_yest_1', title: mockTitles.yesterday1, lastUpdated: subDays(new Date(), 1).toISOString() },
                { id: 'mock_load_yest_2', title: mockTitles.yesterday2, lastUpdated: subDays(new Date(), 1).toISOString() },
                { id: 'mock_load_yest_3', title: mockTitles.yesterday3, lastUpdated: subDays(new Date(), 1).toISOString() },
                { id: 'mock_load_yest_4', title: mockTitles.yesterday4, lastUpdated: subDays(new Date(), 1).toISOString() },
                { id: 'mock_load_yest_5', title: mockTitles.yesterday5, lastUpdated: subDays(new Date(), 1).toISOString() },
                { id: 'mock_load_yest_6', title: mockTitles.yesterday6, lastUpdated: subDays(new Date(), 1).toISOString() }
            ],
            previousWeek: [
                { id: 'mock_load_prev_1', title: mockTitles.prev1, lastUpdated: subDays(new Date(), 3).toISOString() },
                { id: 'mock_load_prev_2', title: mockTitles.prev2, lastUpdated: subDays(new Date(), 4).toISOString() },
                { id: 'mock_load_prev_3', title: mockTitles.prev3, lastUpdated: subDays(new Date(), 5).toISOString() },
                { id: 'mock_load_prev_4', title: mockTitles.prev4, lastUpdated: subDays(new Date(), 6).toISOString() }
            ]
          }
        : groupChatSessionsByDate(); // Otherwise, use the real grouped data

    // Placeholder items shown when there are no chats or when loading
    const renderPlaceholder = (message: string) => (
        <div className={
            `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ` +
            `text-gray-400 ` + // Slightly darker gray for placeholders
            `cursor-default pointer-events-none`
        }>
            <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
                {/* Use Loader if loading, otherwise MessageSquare */}
                {message.toLowerCase().includes("loading") ? (
                     <Loader2 size={16} className="text-gray-400 animate-spin" />
                ) : (
                     <MessageSquare size={16} className="text-gray-400" />
                )}
            </div>
            <span className="truncate italic">{message}</span> {/* Italicize placeholder text */}
        </div>
    );

    return (
        <>
            {/* Header & Collapse Button */}
            <div className="sidebar-header mb-6 flex items-center justify-between flex-shrink-0">
                <h1 className={`text-xl font-bold text-white tracking-wider whitespace-nowrap overflow-hidden ${isCollapsed ? 'hidden' : ''}`}>
                    Projects Hub
                </h1>
                <button
                    onClick={() => setCollapsed(!isCollapsed)}
                    className={`p-1 rounded hover:bg-gray-700 text-gray-300 border-0 bg-transparent ${isCollapsed ? 'mx-auto' : ''}`}
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {isCollapsed ? <ChevronRight size={18} className="text-gray-300" /> : <ChevronLeft size={18} className="text-gray-300" />}
                </button>
            </div>

            {/* Scrollable container for Nav and conditional Chat controls */}
            {/* THIS IS THE DIV THAT NEEDS THE CLOSING TAG */}
            <div className="flex-grow overflow-y-auto overflow-x-hidden">
                {/* Main Navigation */}
                <nav className={`sidebar-nav space-y-1 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
                    {/* NavLink items */}
                    <NavLink to="/" title="Dashboard" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-900/50 text-blue-300 font-medium' : 'text-gray-300 hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><LayoutDashboard size={16}/></div>
                        {!isCollapsed && <span className="truncate">Dashboard</span>}
                    </NavLink>
                    <NavLink to="/projects" title="Projects" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-900/50 text-blue-300 font-medium' : 'text-gray-300 hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><FolderKanban size={16}/></div>
                        {!isCollapsed && <span className="truncate">Projects</span>}
                    </NavLink>
                    <NavLink to="/documents" title="Documents" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-900/50 text-blue-300 font-medium' : 'text-gray-300 hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><FileText size={16}/></div>
                        {!isCollapsed && <span className="truncate">Documents</span>}
                    </NavLink>
                    <NavLink to="/tasks" title="Tasks" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-900/50 text-blue-300 font-medium' : 'text-gray-300 hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><CheckSquare size={16}/></div>
                        {!isCollapsed && <span className="truncate">Tasks</span>}
                    </NavLink>
                    <NavLink to="/alarms" title="Alarms" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-900/50 text-blue-300 font-medium' : 'text-gray-300 hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><Clock size={16}/></div>
                        {!isCollapsed && <span className="truncate">Alarms</span>}
                    </NavLink>
                    <NavLink to="/chat" title="Chat" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-900/50 text-blue-300 font-medium' : 'text-gray-300 hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><MessageSquare size={16} /></div>
                        {!isCollapsed && <span className="truncate">Chat</span>}
                    </NavLink>
                </nav>

                {/* Conditional Chat Section */}
                {isChatRoute && !isCollapsed && (
                    <div className="chat-controls-section mt-4 pt-3 border-t border-gray-700 flex-shrink-0">
                       {/* New Chat Button */}
                       <NavLink
                            to="#" // Using '#' as it doesn't change the route but allows onClick
                            onClick={(e) => {
                                e.preventDefault(); // Prevent navigation
                                onCreateNewChat();
                            }}
                            // Removed isActive check as "New Chat" shouldn't be visually active
                            className="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 text-gray-300 hover:bg-gray-700"
                        >
                            <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
                                <Plus size={16} />
                            </div>
                            <span className="truncate">New Chat</span>
                        </NavLink>

                       {/* Today Section */}
                        <div className="mt-2">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase px-3 mb-1 tracking-wider">Today</h3>
                            <div className="space-y-1">
                                {loadingChats ? (
                                    renderPlaceholder("Loading chats...")
                                ) : today.length > 0 ? (
                                    today.map(chat => (
                                        <NavLink
                                            // If you have chat routes like /chat/:id, use this:
                                            // to={`/chat/${chat.id}`}
                                            // If selecting just updates the main view without route change:
                                            to="#"
                                            key={chat.id}
                                            className={({ isActive }) => // isActive from router might not be relevant if you don't navigate
                                                `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 group relative ` + // Added group and relative for potential delete button
                                                `${selectedChatId === chat.id // Use selectedChatId for highlighting
                                                    ? 'bg-gray-700 text-white font-medium' // Style for selected chat
                                                    : 'text-gray-300 hover:bg-gray-700/60 hover:text-white'}` // Style for non-selected chat
                                            }
                                            onClick={(e) => {
                                                e.preventDefault(); // Prevent navigation if using to="#"
                                                onSelectChat(chat.id);
                                            }}
                                            title={chat.title} // Add title attribute for full text on hover
                                        >
                                            <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
                                                <MessageSquare size={16} />
                                            </div>
                                            <span className="truncate flex-1">{chat.title}</span>
                                            {/* Optional: Delete button shown on hover */}
                                            {selectedChatId === chat.id && ( // Or show always/on hover using group-hover:flex
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation(); // Prevent NavLink click
                                                        e.preventDefault();
                                                        if (window.confirm(`Are you sure you want to delete chat "${chat.title}"?`)) {
                                                            onDeleteChat(chat.id);
                                                        }
                                                    }}
                                                    className="ml-auto p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity absolute right-1 top-1/2 -translate-y-1/2"
                                                    title="Delete chat"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </NavLink>
                                    ))
                                ) : (
                                    renderPlaceholder("No chats today")
                                )}
                            </div>
                        </div>

                       {/* Yesterday Section */}
                        <div className="mt-3">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase px-3 mb-1 tracking-wider">Yesterday</h3>
                            <div className="space-y-1">
                                {loadingChats ? (
                                    renderPlaceholder("Loading yesterday's...")
                                ) : yesterday.length > 0 ? (
                                    yesterday.map(chat => (
                                        <NavLink
                                            to="#" // Or `/chat/${chat.id}`
                                            key={chat.id}
                                            className={({ isActive }) =>
                                                `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 group relative ` +
                                                `${selectedChatId === chat.id
                                                    ? 'bg-gray-700 text-white font-medium'
                                                    : 'text-gray-300 hover:bg-gray-700/60 hover:text-white'}`
                                            }
                                            onClick={(e) => {
                                                e.preventDefault();
                                                onSelectChat(chat.id);
                                            }}
                                             title={chat.title}
                                        >
                                            <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
                                                <MessageSquare size={16} />
                                            </div>
                                            <span className="truncate flex-1">{chat.title}</span>
                                             {/* Optional: Delete button */}
                                            {selectedChatId === chat.id && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (window.confirm(`Delete "${chat.title}"?`)) onDeleteChat(chat.id); }}
                                                    className="ml-auto p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity absolute right-1 top-1/2 -translate-y-1/2"
                                                    title="Delete chat"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </NavLink>
                                    ))
                                ) : (
                                    renderPlaceholder("No chats from yesterday")
                                )}
                            </div>
                        </div>

                        {/* Previous 7 Days Section */}
                        <div className="mt-3">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase px-3 mb-1 tracking-wider">Previous 7 Days</h3>
                            <div className="space-y-1">
                            {loadingChats ? (
                                renderPlaceholder("Loading previous...")
                            ) : previousWeek.length > 0 ? (
                                (
                                    previousWeek.map(chat => (
                                        <NavLink
                                            to="#" // Or `/chat/${chat.id}`
                                            key={chat.id}
                                            className={({ isActive }) =>
                                                `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 group relative ` +
                                                `${selectedChatId === chat.id
                                                    ? 'bg-gray-700 text-white font-medium'
                                                    : 'text-gray-300 hover:bg-gray-700/60 hover:text-white'}`
                                            }
                                            onClick={(e) => {
                                                e.preventDefault();
                                                onSelectChat(chat.id);
                                            }}
                                             title={chat.title}
                                        >
                                            <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
                                                <MessageSquare size={16} />
                                            </div>
                                            <span className="truncate flex-1">{chat.title}</span>
                                            {/* Optional: Delete button */}
                                            {selectedChatId === chat.id && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (window.confirm(`Delete "${chat.title}"?`)) onDeleteChat(chat.id); }}
                                                    className="ml-auto p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity absolute right-1 top-1/2 -translate-y-1/2"
                                                    title="Delete chat"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </NavLink>
                                    ))
                                )
                            ) : (
                                renderPlaceholder("No previous chats")
                            )}
                            </div>
                        </div>

                         {/* Settings Button - Moved below chat history */}
                        <NavLink
                            to="#"
                            onClick={(e) => {
                                e.preventDefault();
                                setShowSettings(!showSettings);
                            }}
                            className={({ isActive }) => // isActive is not really applicable here
                                `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 mt-4 border-t border-gray-700 pt-3
                                ${showSettings ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700/60 hover:text-white'}` // Highlight when open
                            }
                        >
                            <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
                                <SettingsIcon size={16} />
                            </div>
                            <span className="truncate">Settings</span>
                             <ChevronRight size={16} className={`ml-auto transform transition-transform ${showSettings ? 'rotate-90' : ''}`} />
                        </NavLink>

                        {/* Settings Panel (conditionally rendered) */}
                        {showSettings && (
                            <div className="text-sm px-3 py-3 bg-gray-800/50 rounded-b-lg mx-0 border-x border-b border-gray-700 space-y-4 mt-0"> {/* Adjusted styling */}
                                {/* Model Selection */}
                                <div className="space-y-1">
                                    <label htmlFor="modelSelect" className="block text-xs font-medium text-gray-400">Model</label>
                                    {loadingModels ? (
                                         <div className="flex items-center text-gray-400 text-xs italic"><Loader2 size={14} className="animate-spin mr-1" /> Loading models...</div>
                                    ) : models.length > 0 ? (
                                        <select
                                            id="modelSelect"
                                            value={selectedModel}
                                            onChange={(e) => onSelectModel(e.target.value)}
                                            className="block w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:ring-blue-500 focus:border-blue-500"
                                        >
                                            {models.map(model => (
                                                <option key={model.id} value={model.id}>{model.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <div className="text-xs text-red-400">No models available.</div>
                                    )}
                                </div>

                                {/* Temperature Slider */}
                                <div className="space-y-1">
                                    <label htmlFor="temperature" className="block text-xs font-medium text-gray-400">Temperature: {temperature.toFixed(1)}</label>
                                    <input
                                        type="range"
                                        id="temperature"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={temperature}
                                        onChange={(e) => handleTemperatureChange(parseFloat(e.target.value))}
                                        className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer range-sm accent-blue-500" // Use accent color
                                    />
                                </div>

                                {/* Context Length Slider */}
                                <div className="space-y-1">
                                    <label htmlFor="contextLength" className="block text-xs font-medium text-gray-400">Context History: {contextLength}</label>
                                    <input
                                        type="range"
                                        id="contextLength"
                                        min="1" // Min context length
                                        max="20" // Max context length (adjust as needed)
                                        step="1"
                                        value={contextLength}
                                        onChange={(e) => handleContextLengthChange(parseInt(e.target.value, 10))}
                                        className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer range-sm accent-blue-500"
                                    />
                                </div>
                                 {/* Display Chat Error if any */}
                                {chatError && <div className="text-xs text-red-400">{chatError}</div>}
                            </div>
                        )}

                    </div> /* End of chat-controls-section */
                )}
            </div> {/* <<<<<<<<<<<<< THIS IS THE CORRECTED CLOSING TAG for flex-grow div */}

            {/* Footer Section */}
            <div className={`sidebar-footer mt-auto pt-4 border-t border-gray-700 ${isCollapsed ? 'px-2 py-2' : 'px-3 py-2'} flex-shrink-0`}>
                 {/* Focus Monitor Toggle */}
                 {!isCollapsed && (
                     <div className="mb-2"> {/* Add margin below if not collapsed */}
                         <button
                             className="flex items-center w-full px-2 py-1.5 text-gray-300 text-sm hover:text-blue-300 bg-gray-800/40 border border-gray-700 hover:bg-gray-700/50 rounded transition-colors"
                             onClick={() => handleFocusToggle({ target: { checked: !isFocusMonitorActive } } as any)} // Simulate event for toggle
                             title={isFocusMonitorActive ? "Deactivate Focus Monitor" : "Activate Focus Monitor"}
                         >
                             <div className={`mr-2 flex-shrink-0 ${loadingFocusStatus ? 'animate-pulse' : ''}`}>
                                 <Database size={16} className={isFocusMonitorActive ? "text-green-400" : "text-gray-500"} />
                             </div>
                             <span className="truncate flex-1 text-left">Focus Monitor</span>
                             <div className="ml-auto flex items-center">
                                 {loadingFocusStatus && <Loader2 size={14} className="animate-spin mr-2 text-gray-400" />}
                                 {/* Simple switch-like visual */}
                                 <div className={`w-8 h-4 rounded-full flex items-center px-0.5 transition-colors ${isFocusMonitorActive ? 'bg-green-600 justify-end' : 'bg-gray-600 justify-start'}`}>
                                    <div className="w-3 h-3 bg-white rounded-full shadow"></div>
                                 </div>
                                 {/* Hidden checkbox for accessibility/semantics if needed, but button handles interaction */}
                                 {/* <input type="checkbox" checked={isFocusMonitorActive} readOnly className="sr-only" /> */}
                             </div>
                         </button>
                         {sidebarError && sidebarError.includes('Failed to toggle') &&
                             <div className="text-xs text-red-400 px-1 mt-1">{sidebarError}</div>
                         }
                     </div>
                 )}
                 {isCollapsed && ( // Simplified view for collapsed state
                     <button
                         className="flex items-center justify-center w-full p-2 text-gray-300 hover:text-blue-300 bg-gray-800/40 border border-gray-700 hover:bg-gray-700/50 rounded transition-colors"
                         onClick={() => handleFocusToggle({ target: { checked: !isFocusMonitorActive } } as any)}
                         title={`Focus Monitor: ${isFocusMonitorActive ? 'Active' : 'Inactive'} ${loadingFocusStatus ? '(loading)' : ''}`}
                      >
                         {loadingFocusStatus
                            ? <Loader2 size={16} className="animate-spin text-gray-400" />
                            : <Database size={16} className={isFocusMonitorActive ? "text-green-400" : "text-gray-500"} />
                         }
                      </button>
                 )}

            </div>
        </>
    );
};

export default Sidebar;