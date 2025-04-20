// src/components/Sidebar.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import axios from 'axios';
import { eventBus } from '../App';
import { ChatMeta, Model } from '../pages/Chat/Chat';
import {
    ChevronLeft, ChevronRight, Plus, MessageSquare, Settings as SettingsIcon, Trash2, Loader2,
    LayoutDashboard, FolderKanban, FileText, CheckSquare, Focus // Use Focus icon for monitor
} from 'lucide-react';

// --- Interfaces ---
interface Alarm { /* ... */ }
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
}

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
    setCollapsed
}) => {
    const location = useLocation();
    const isChatRoute = location.pathname === '/chat';

    // --- State ---
    const [alarms, setAlarms] = useState<Alarm[]>([]);
    const [isFocusMonitorActive, setIsFocusMonitorActive] = useState(true);
    const [loadingAlarms, setLoadingAlarms] = useState(true);
    const [loadingFocusStatus, setLoadingFocusStatus] = useState(true);
    const [sidebarError, setSidebarError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(true);
    const [temperature, setTemperature] = useState(0.7);
    const [contextLength, setContextLength] = useState(10);

    // --- Helper Functions ---
    const getAlarmStatus = (alarm: Alarm): 'red' | 'amber' | 'green' => {
        const daysLeft = alarm.days;
        if (daysLeft <= alarm.thresholds.red) return 'red';
        if (daysLeft <= alarm.thresholds.amber) return 'amber';
        return 'green';
    };
    const getAlarmPillClasses = (status: string) => {
        switch (status) {
            case 'red': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 border border-red-300 dark:border-red-700/50';
            case 'amber': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-700/40 dark:text-yellow-100 border border-yellow-300 dark:border-yellow-600/50';
            case 'green': return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200 border border-green-300 dark:border-green-700/50';
            default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600';
        }
    };
    const getAlarmIcon = (_status: string) => '⏰';

    // --- Fetch Sidebar-Specific Data ---
    const fetchSidebarData = useCallback(async (isInitial = false) => {
        let errors: string[] = [];
        // Use function form of setState to avoid stale state issues if called rapidly
        if (isInitial || !loadingAlarms) setLoadingAlarms(true);
        if (isInitial || !loadingFocusStatus) setLoadingFocusStatus(true);
        // Fetch alarms
        try {
            const alarmResponse = await axios.get('http://localhost:8000/alarms');
            setAlarms(alarmResponse.data.alarms || []);
            setSidebarError(prev => prev?.replace('Failed to load alarms.','').trim() || null);
        } catch (err) {
            console.error('Sidebar: Error fetching alarms:', err); setAlarms([]); errors.push('Failed to load alarms.');
        } finally { setLoadingAlarms(false); }
        // Fetch focus status
         try {
             const focusResponse = await axios.get('http://localhost:8000/focus/status');
             setIsFocusMonitorActive(focusResponse.data.active);
              setSidebarError(prev => prev?.replace('Failed to get focus status.','').trim() || null);
         } catch (err) {
             console.error('Sidebar: Error fetching focus status:', err); errors.push('Failed to get focus status.');
         } finally { setLoadingFocusStatus(false); }
         setSidebarError(errors.length > 0 ? errors.join(' ') : null);
    }, []); // Empty dependency array - this function is stable

    // --- Effects ---
    useEffect(() => {
        fetchSidebarData(true);
        const intervalId = setInterval(() => fetchSidebarData(false), 5 * 60 * 1000);
        const handleAlarmUpdate = () => { console.log("WS: Alarms updated"); fetchSidebarData(false); };
        const handleFocusStatusUpdate = (message: { active: boolean }) => { console.log("WS: Focus status update"); setIsFocusMonitorActive(message.active); };
        const unsubAlarms = eventBus.on('alarms_updated', handleAlarmUpdate);
        const unsubFocus = eventBus.on('focus_status_changed', handleFocusStatusUpdate);
        return () => { clearInterval(intervalId); unsubAlarms(); unsubFocus(); };
    }, [fetchSidebarData]);

    // --- Event Handlers ---
    const handleFocusToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const newState = event.target.checked;
        setIsFocusMonitorActive(newState);
        setSidebarError(null);
        try {
        const response = await axios.post('http://localhost:8000/focus/toggle');
        setIsFocusMonitorActive(response.data.active);
        } catch (error) {
        console.error('Failed to toggle focus monitor:', error);
        setIsFocusMonitorActive(!newState);
        setSidebarError('Failed to toggle Focus Monitor.');
        }
    };

    const handleAddAlarm = async () => {
        try {
            const alarmTitle = prompt("Enter alarm title:");
            if (!alarmTitle) return;
            const daysTillDue = prompt("Enter days until due:", "30");
            if (!daysTillDue) return;
            await axios.post("http://localhost:8000/alarms", {
                id: `alarm-${Date.now()}`, title: alarmTitle,
                days: parseInt(daysTillDue), thresholds: { red: 3, amber: 7, green: 14 }
            });
            fetchSidebarData(false);
        } catch (error) {
            console.error("Failed to create alarm:", error);
            setSidebarError("Failed to create alarm.");
        }
    };

    return (
        <>
            {/* Header & Collapse Button */}
            <div className="sidebar-header mb-6 flex items-center justify-between flex-shrink-0">
                <h1 className={`text-xl font-bold text-gray-800 dark:text-gray-100 tracking-wider whitespace-nowrap overflow-hidden ${isCollapsed ? 'hidden' : ''}`}>
                    Projects Hub
                </h1>
                <button
                    onClick={() => setCollapsed(!isCollapsed)}
                    className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${isCollapsed ? 'mx-auto' : ''}`}
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
            </div>

            {/* Scrollable container for Nav and conditional Chat controls */}
            {/* Apply flex-grow AND overflow-hidden here */}
            <div className="flex-grow overflow-y-auto overflow-x-hidden">
                {/* Main Navigation */}
                <nav className={`sidebar-nav space-y-1 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
                    {/* NavLink items remain the same, using isCollapsed for conditional rendering */}
                    <NavLink to="/" title="Dashboard" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><LayoutDashboard size={16}/></div>
                        {!isCollapsed && <span className="truncate">Dashboard</span>}
                    </NavLink>
                    <NavLink to="/projects" title="Projects" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><FolderKanban size={16}/></div>
                        {!isCollapsed && <span className="truncate">Projects</span>}
                    </NavLink>
                    <NavLink to="/documents" title="Documents" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><FileText size={16}/></div>
                        {!isCollapsed && <span className="truncate">Documents</span>}
                    </NavLink>
                    <NavLink to="/tasks" title="Tasks" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><CheckSquare size={16}/></div>
                        {!isCollapsed && <span className="truncate">Tasks</span>}
                    </NavLink>
                    <NavLink to="/chat" title="Chat" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'} ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0"><MessageSquare size={16} /></div>
                        {!isCollapsed && <span className="truncate">Chat</span>}
                    </NavLink>
                </nav>

                {/* Conditional Chat Section */}
                {isChatRoute && !isCollapsed && (
                    <div className="chat-controls-section mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                       {/* ... Chat section content ... */}
                       <button onClick={onCreateNewChat} className="flex items-center gap-2 text-sm w-full px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-200 mb-2">
                            <Plus size={16} /> New Chat
                       </button>
                       {loadingChats ? ( <div className="text-xs text-gray-400 px-3 py-1 flex items-center gap-2"> <Loader2 className="animate-spin h-3 w-3" /> Loading chats...</div> )
                       : chatError && chatError.includes("sessions") ? ( <div className="text-xs text-red-500 px-3 py-1">{chatError.replace('Failed to load chat sessions.', '').trim()}</div> )
                       : chatSessions.length > 0 ? (
                           <nav className="sessions-list space-y-0.5 max-h-48 overflow-y-auto mb-2">
                               {chatSessions.map((chat) => (
                                   <div key={chat.id} className="group flex items-center">
                                       <button onClick={() => onSelectChat(chat.id)} className={`flex items-center gap-2 w-full truncate px-3 py-1.5 rounded text-left text-xs ${selectedChatId === chat.id ? "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-medium" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
                                           <MessageSquare size={14} className="flex-shrink-0" />
                                           <span className="truncate flex-1" title={chat.title}>{chat.title}</span>
                                       </button>
                                       <button className="ml-1 p-0.5 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 focus:opacity-100 flex-shrink-0" onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }} title="Delete session">
                                           <Trash2 size={12} />
                                       </button>
                                   </div>
                               ))}
                           </nav>
                        ) : ( <p className="text-xs text-gray-500 px-4 py-2">No chats yet.</p> )}
                        {/* Chat Settings Accordion */}
                       <button onClick={() => setShowSettings((s) => !s)} className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-200">
                           <SettingsIcon size={16} /> <span className="flex-1 text-left">Settings</span> {showSettings ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                       </button>
                       {showSettings && ( <div className="px-3 pt-2 pb-4 space-y-3 text-xs"> {/* ... Settings content ... */} </div> )}
                    </div>
                )}
            </div> {/* End of flex-grow container */}


            {/* --- Alarms & Footer (These sections are now correctly positioned at the bottom) --- */}
            {!isCollapsed && (
                <div className="sidebar-section mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <h2 className="text-xs uppercase font-semibold mb-2 text-gray-500 dark:text-gray-400 tracking-wider">Alarms</h2>
                    {/* ... Alarms rendering logic ... */}
                     {sidebarError && !sidebarError.includes('focus status') && (
                         <div className="text-xs text-red-500 dark:text-red-400 mb-2">{sidebarError.replace('Failed to load alarms.','').trim()}</div>
                     )}
                     {loadingAlarms ? ( <div className="text-xs text-gray-400">Loading...</div> )
                     : alarms.length > 0 ? (
                         <div className="alarms-list space-y-1 max-h-24 overflow-y-auto"> {/* Limit height */}
                             {alarms.map((alarm) => { // Show all alarms in scrollable area
                                 const status = getAlarmStatus(alarm);
                                 return (
                                     <div key={alarm.id} className={`alarm-pill text-xs px-2 py-1 rounded-full flex items-center justify-between gap-2 ${getAlarmPillClasses(status)}`} title={`${alarm.title} - ${alarm.days}d`}>
                                         <div className="flex-shrink-0">{getAlarmIcon(status)}</div>
                                         <span className="alarm-title flex-1 truncate">{alarm.title}</span>
                                         <span className="alarm-days font-medium flex-shrink-0">{alarm.days}d</span>
                                     </div>
                                 )
                             })}
                         </div>
                     ) : ( <div className="text-xs text-gray-500 dark:text-gray-400">No alarms set</div> )}
                     <button onClick={handleAddAlarm} className="mt-2 text-blue-600 dark:text-blue-400 hover:underline text-xs">+ Add Alarm</button>
                </div>
            )}

            {/* Footer Section */}
            <div className={`sidebar-footer mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 ${isCollapsed ? 'flex justify-center py-2' : ''} flex-shrink-0`}>
                <div className={`focus-monitor-toggle flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} text-sm text-gray-700 dark:text-gray-200`}>
                    <label htmlFor="focus-toggle" className="cursor-pointer select-none flex items-center gap-2" title={loadingFocusStatus ? "Loading status..." : (isFocusMonitorActive ? "Focus Monitor is ON" : "Focus Monitor is OFF")}>
                         {/* Use a different icon maybe */}
                         <div className="flex-shrink-0 w-5 h-5">
                            <Focus size={16} /> {/* Lucide Focus icon */}
                         </div>
                         {!isCollapsed && <span>Focus Monitor</span>}
                    </label>
                    {!isCollapsed && (
                        <div className="relative inline-block w-10 h-6 align-middle select-none">
                         {loadingFocusStatus ? <span className="text-xs text-gray-400 italic">...</span> : (
                             <>
                                 <input type="checkbox" name="focus-toggle" id="focus-toggle"
                                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white dark:bg-gray-400 border-4 appearance-none cursor-pointer border-gray-300 dark:border-gray-500 checked:bg-blue-500 checked:dark:bg-blue-500 checked:border-blue-500 checked:dark:border-blue-500 checked:right-0 transition-all duration-200 ease-in-out"
                                    style={{ right: isFocusMonitorActive ? '0' : 'auto' }}
                                    checked={isFocusMonitorActive} onChange={handleFocusToggle} disabled={loadingFocusStatus}
                                 />
                                 <label htmlFor="focus-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 dark:bg-gray-600 cursor-pointer"></label>
                             </>
                         )}
                        </div>
                    )}
                </div>
                 {sidebarError && sidebarError.includes('focus status') && !isCollapsed &&
                     <div className="text-xs text-red-500 dark:text-red-400 mt-1">{sidebarError.replace('Failed to get focus status.','').trim()}</div>
                 }
            </div>
        </>
    );
};

export default Sidebar;