import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { format, formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
// Import Dnd types and backend
import { DndProvider, useDrag, useDrop, DropTargetMonitor } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { XYCoord } from 'dnd-core'; // Type needed for clientOffset
// Import Tauri API functions
import { invoke } from "@tauri-apps/api";
import { appDataDir, join } from "@tauri-apps/api/path"; 
// Import shared event bus
import { eventBus } from '../App';
import { useCommandPalette } from '../components/CommandPalette';

// --- Interfaces ---
interface FocusSummary {
  date: string;
  totalTime: number;
  appBreakdown: {
    appName: string;
    timeSpent: number;
    percentage: number;
    exePath?: string;
  }[];
  screenshots: string[];
  keywords: string[];
  focusScore?: number;
  distractionEvents?: number;
  meetingTime?: number;
}

interface Alarm {
  id: string;
  title: string;
  days: number;
  time?: string;
  thresholds: {
    green: number;
    amber: number;
    red: number;
  };
}

interface PinnedDoc {
  id: string; // Use path as ID
  title: string;
  path: string;
  lastModified?: string;
}

interface DragItem {
  type: string;
  id: string;
  index: number;
}

// --- Constants ---
const ItemTypes = {
  PINNED_DOC: 'pinnedDoc',
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FA8072', '#E066FF', '#FF5733', '#C70039']; // Extended colors

// --- PinnedDocCard Component ---
const PinnedDocCard: React.FC<{
  doc: PinnedDoc;
  index: number;
  moveDoc: (dragIndex: number, hoverIndex: number) => void;
  togglePin: (id: string) => void;
}> = ({ doc, index, moveDoc, togglePin }) => {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: ItemTypes.PINNED_DOC,
    item: (): DragItem => ({ type: ItemTypes.PINNED_DOC, id: doc.id, index }),
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop<DragItem, void, unknown>({
    accept: ItemTypes.PINNED_DOC,
    hover: (item: DragItem, monitor: DropTargetMonitor<DragItem, void>) => {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;
      const hoverBoundingRect = ref.current.getBoundingClientRect();
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      // Ensure clientOffset is not null and assert type
      if (!clientOffset) return;
      const hoverClientY = (clientOffset as XYCoord).y - hoverBoundingRect.top;
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;
      moveDoc(dragIndex, hoverIndex);
      item.index = hoverIndex; // Mutate monitor item for performance
    },
  });

  drag(drop(ref));
  const opacity = isDragging ? 0.4 : 1;

  const getFileIcon = (path: string = '') => {
    const extension = path.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'md': return '📄'; case 'pdf': return '📕'; case 'doc': case 'docx': return '📘';
      case 'xls': case 'xlsx': return '📗'; case 'ppt': case 'pptx': return '📙';
      case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': return '🖼️';
      case 'zip': case 'rar': case '7z': return '📦'; case 'exe': return '⚙️'; case 'txt': return '📝';
      case 'yaml': case 'json': return '{..}'; case 'html': return '</>'; case 'css': return '#{}';
      case 'js': case 'ts': return ' J S '; case 'jsx': case 'tsx': return '<R>';
      default: return '📎';
    }
  };

  return (
    <div
      ref={ref}
      className="card doc-card bg-white dark:bg-gray-800 shadow rounded p-3 flex items-start gap-3 border border-gray-200 dark:border-gray-700 cursor-grab active:cursor-grabbing transition-opacity"
      style={{ opacity }}
      title={`Path: ${doc.path}\nLast Modified: ${doc.lastModified ? format(new Date(doc.lastModified), 'Pp') : 'N/A'}`}
    >
      <div className="doc-icon text-xl text-gray-500 dark:text-gray-400 mt-1 flex-shrink-0">
        {getFileIcon(doc.path)}
      </div>
      <div className="doc-content flex-1 overflow-hidden">
        <h3 className="doc-title text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{doc.title || doc.path}</h3>
        <p className="doc-path text-xs text-gray-500 dark:text-gray-400 truncate">{doc.path}</p>
        {doc.lastModified && (
          <p className="doc-last-modified text-xs text-gray-500 dark:text-gray-400 mt-1">
            Modified: {formatDistanceToNow(new Date(doc.lastModified), { addSuffix: true })}
          </p>
        )}
      </div>
      <div className="doc-actions ml-auto flex-shrink-0">
        <button
          className={`pin-button text-lg ${true ? 'text-yellow-500 hover:text-yellow-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
          onClick={() => togglePin(doc.id)}
          title="Unpin document"
          aria-label="Unpin document"
        >
          ★
        </button>
      </div>
    </div>
  );
};

// --- Empty PinnedDocCard ---
const EmptyDocCard: React.FC = () => {
  return (
    <div className="empty-doc-card flex items-center justify-center h-20 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded text-sm text-gray-500 dark:text-gray-400">
      No documents pinned.
    </div>
  );
};


// --- Dashboard Component ---
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [focusSummary, setFocusSummary] = useState<FocusSummary | null>(null);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [pinnedDocs, setPinnedDocs] = useState<PinnedDoc[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loadingFocus, setLoadingFocus] = useState(true);
  const [loadingAlarms, setLoadingAlarms] = useState(true);
  const [loadingPinnedDocs, setLoadingPinnedDocs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userHubPath, setUserHubPath] = useState<string | null>(null); // Store resolved user's Hub path
  const [isInitializing, setIsInitializing] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState<{
    initialized: boolean;
    error?: string;
    last_opened?: string;
  }>({ initialized: false });

  const today = format(new Date(), 'yyyy-MM-dd');

  // --- Effect for determining Hub Path ---
  useEffect(() => {
      const findHubPath = async () => {
           try {
                // Check if we're running in a Tauri environment
                if (window.__TAURI_IPC__ && typeof window.__TAURI_IPC__ === 'function') {
                    // FIXME: Replace this with a reliable method to get/store the user-chosen ProjectsHub path.
                    // Using AppDataDir is just a temporary placeholder.
                    const dataDir = await appDataDir();
                    const hubPath = await join(dataDir, 'ProjectsHub'); // Assumes folder name
                    // Could add a check here to see if hubPath actually exists
                    setUserHubPath(hubPath);
                    console.log("User Hub Path (determined via Tauri):", hubPath);
                } else {
                    // If not running in Tauri, use a default path
                    console.log("Not running in a Tauri environment, using default Hub path");
                    setUserHubPath("/hub_data");
                }
           } catch (e) {
                console.error("Critical: Failed to determine Hub path:", e);
                setError("Could not determine ProjectsHub data location. Some features may not work.");
                // Set a fallback path
                setUserHubPath("/hub_data");
           }
      };
      findHubPath();
  }, []); // Run once on mount

  // --- Data Fetching Logic ---
  const fetchDashboardData = useCallback(async () => {
    // Reset loading states and error
    setLoadingFocus(true);
    setLoadingAlarms(true);
    setLoadingPinnedDocs(true);
    setError(null);
    let errorsAccumulator: string[] = [];

    const fetchFocus = async () => {
        try {
            const res = await axios.get(`http://localhost:8000/focus/summary?date=${today}`);
            setFocusSummary(res.data);
        } catch (err) {
            console.error('Error fetching focus summary:', err);
            setFocusSummary(null);
            if (!axios.isAxiosError(err) || err.response?.status !== 404) {
                errorsAccumulator.push('Failed to load focus summary.');
            }
        } finally { setLoadingFocus(false); }
    };

    const fetchAlarms = async () => {
         try {
            const res = await axios.get('http://localhost:8000/alarms');
            setAlarms(res.data.alarms || []);
        } catch (err) {
            console.error('Error fetching alarms:', err);
            setAlarms([]);
            errorsAccumulator.push('Failed to load alarms.');
        } finally { setLoadingAlarms(false); }
    };

    const fetchPinnedDocs = async () => {
        // TODO: Replace with actual API call, e.g., GET /meta/pinned_docs
        try {
             console.log("Fetching pinned docs (using mock data)...");
             await new Promise(resolve => setTimeout(resolve, 200)); // Simulate delay
             const mockDocsData = [
                 { id: 'Project-A/docs/overview.md', title: 'Project Overview', path: 'Project-A/docs/overview.md', lastModified: '2025-04-18T14:30:00Z' },
                 { id: 'Project-B/docs/meeting-notes.md', title: 'Meeting Notes', path: 'Project-B/docs/meeting-notes.md', lastModified: '2025-04-15T10:00:00Z' },
                 { id: 'Project-A/docs/roadmap.md', title: 'Development Roadmap', path: 'Project-A/docs/roadmap.md', lastModified: '2025-04-16T09:15:00Z' },
             ];
             setPinnedDocs(mockDocsData);
        } catch (err) {
             console.error('Error fetching pinned docs:', err);
             setPinnedDocs([]);
             errorsAccumulator.push('Failed to load pinned documents.');
        } finally { setLoadingPinnedDocs(false); }
    };

    // Run fetches concurrently
    await Promise.all([fetchFocus(), fetchAlarms(), fetchPinnedDocs()]);

    if (errorsAccumulator.length > 0) {
         setError(errorsAccumulator.join(' ')); // Combine errors
    }

  }, [today]); // Depend only on today's date

  // --- Effect for Initial Fetch and WebSocket Listeners ---
  useEffect(() => {
    fetchDashboardData(); // Initial fetch

    const handleUpdate = (message: any) => {
         console.log(`Dashboard received WS message: ${message?.type}, refetching data...`);
         fetchDashboardData(); // Refetch all dashboard data on relevant updates
    };

    const listeners = [
         eventBus.on('alarms_updated', handleUpdate),
         eventBus.on('focus_summary_updated', (msg: any) => { if (msg.date === today) handleUpdate(msg); }),
         eventBus.on('meta_updated', handleUpdate), // Assume pinned docs are in meta
         // Listen for workspace snap events to potentially update UI feedback
         eventBus.on('workspace-snap-started', () => console.log("Workspace snap started...")),
         eventBus.on('workspace-snap-success', () => console.log("Workspace snap success!")),
         eventBus.on('workspace-snap-error', (errMsg) => { console.error("Workspace snap error:", errMsg); setError(`Workspace Snap failed: ${errMsg}`); }),
         eventBus.on('workspace-snap-stderr', (line) => console.warn("[Snap Agent STDERR]", line)),
    ];

    return () => listeners.forEach(unsub => unsub()); // Cleanup all listeners

  }, [fetchDashboardData, today]); // Re-run if fetch function or date changes

  useEffect(() => {
    checkWorkspaceStatus();
  }, []);

  const checkWorkspaceStatus = async () => {
    try {
      const response = await axios.get('http://localhost:8000/workspace/status');
      setWorkspaceStatus(response.data);
    } catch (error) {
      console.error('Failed to check workspace status:', error);
      setWorkspaceStatus({ initialized: false, error: 'Failed to check workspace status' });
    }
  };

  // --- Helper Functions ---
  const getAlarmStatus = (alarm: Alarm): 'red' | 'amber' | 'green' => {
    const daysLeft = alarm.days;
    if (daysLeft <= alarm.thresholds.red) return 'red';
    if (daysLeft <= alarm.thresholds.amber) return 'amber';
    return 'green';
  };

   const getAlarmStatusClasses = (status: string) => {
     switch (status) {
      case 'red': return 'border-l-red-500 bg-red-50 dark:bg-red-900/30 dark:border-l-red-400 text-red-800 dark:text-red-200';
      case 'amber': return 'border-l-yellow-500 bg-yellow-50 dark:bg-yellow-700/20 dark:border-l-yellow-400 text-yellow-800 dark:text-yellow-100';
      case 'green': return 'border-l-green-500 bg-green-50 dark:bg-green-900/30 dark:border-l-green-400 text-green-800 dark:text-green-200';
      default: return 'border-l-gray-500 bg-gray-50 dark:bg-gray-800/30 text-gray-700 dark:text-gray-300';
    }
  };

  const formatTime = (seconds: number = 0): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  // --- Action Handlers ---
   const handleStartWorkspace = async () => {
        setIsInitializing(true);
        setError(null); // Clear previous errors

        try {
            if (!userHubPath) {
                 setError("Cannot start workspace: ProjectsHub path not determined.");
                 console.error("Cannot start workspace: userHubPath is null");
                 return;
            }

            // First check if we need to initialize the workspace
            try {
                // Check if workspace is already initialized
                const statusResponse = await axios.get('http://localhost:8000/workspace/status');
                if (!statusResponse.data.initialized) {
                    // Initialize the workspace
                    const initResponse = await axios.post('http://localhost:8000/workspace/initialize');
                    console.log("Workspace initialized:", initResponse.data);
                }
            } catch (error) {
                console.error("Failed to check workspace status:", error);
                // Continue anyway, the Tauri command might still work
            }

            const configPath = await join(userHubPath, 'workspace_layout.json');
            console.log(`Invoking trigger_workspace_snap with config: ${configPath}`);
            
            try {
                // Check if we're running in a Tauri environment
                if (window.__TAURI_IPC__ && typeof window.__TAURI_IPC__ === 'function') {
                    // Try the Tauri invoke approach
                    await invoke('trigger_workspace_snap', {
                        configPath: configPath,
                    });
                    console.log("trigger_workspace_snap invoke called successfully.");
                } else {
                    console.log("Not running in Tauri environment, using backend API for workspace snap");
                    // Use the backend API directly
                    await axios.post('http://localhost:8000/workspace/start_snap');
                }
            } catch (tauriError) {
                // Fallback to direct API call if Tauri invoke fails
                console.error("Tauri invoke failed, trying direct API:", tauriError);
                
                // Execute the workspace_snap_agent.py script via the backend API
                // This would require a backend endpoint to trigger the script
                alert("Starting workspace via Tauri failed. Please try again or check logs.");
                throw tauriError;
            }

            // Check workspace status after initialization
            await checkWorkspaceStatus();
        } catch (error) {
             console.error('Failed to start workspace:', error);
             setError(`Failed to start workspace: ${error}`);
        } finally {
             setIsInitializing(false);
        }
    };

  const handleQuickAction = async (action: string) => {
      console.log(`Quick action clicked: ${action}`);
      if (action === 'start-workspace') {
           await handleStartWorkspace();
      } else if (action === 'cmd-palette') {
           // Use the command palette toggle function
           window.toggleCommandPalette(); // Use the global function
      } else if (action === 'new-project') {
           // Open a modal to create a new project
           try {
               const projectName = prompt("Enter project name:");
               if (!projectName) return; // User cancelled
               
               const response = await axios.post('http://localhost:8000/projects', {
                 title: projectName,
                 status: "active",
                 tags: [],
                 description: ""
               });
               
               console.log("Created new project:", response.data);
               
               // Reload projects or navigate to the projects page
               navigate('/projects');
           } catch (error) {
               console.error("Failed to create project:", error);
               setError(`Failed to create project: ${error}`);
           }
      }
  }

  const moveDoc = useCallback((dragIndex: number, hoverIndex: number) => {
    setPinnedDocs((prevDocs) => {
        const newDocs = [...prevDocs];
        const [draggedDoc] = newDocs.splice(dragIndex, 1);
        newDocs.splice(hoverIndex, 0, draggedDoc);
        // TODO: API Call - Persist this new order
        console.log("New pinned doc order (needs saving via API):", newDocs.map(d => d.path));
        // axios.put('/meta/pinned_docs', { paths: newDocs.map(d => d.path) });
        return newDocs;
    });
  }, []);

  const togglePin = (id: string) => {
    // TODO: API Call - Remove doc from pinned list in 00-meta.yaml
    console.log('Toggle pin for doc (needs API call):', id);
    // Optimistically remove from UI
    setPinnedDocs(prev => prev.filter(doc => doc.id !== id));
  };


  // --- Render ---
  return (
    <div className="dashboard-container p-4 md:p-6 lg:p-8 w-full text-gray-900 dark:text-gray-100 h-full flex flex-col">
      {/* Header */}
      <div className="header flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3 flex-shrink-0">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="tabs flex border-b border-gray-200 dark:border-gray-700" role="tablist">
          <button
            className={`tab px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'dashboard' ? 'border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'}`}
            onClick={() => setActiveTab('dashboard')}
            role="tab" aria-selected={activeTab === 'dashboard'} aria-controls="dashboard-panel" id="dashboard-tab"
          >
            Overview
          </button>
          <button
            className={`tab px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'focus-report' ? 'border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'}`}
            onClick={() => setActiveTab('focus-report')}
            role="tab" aria-selected={activeTab === 'focus-report'} aria-controls="focus-report-panel" id="focus-report-tab"
          >
            Focus Report ({today})
          </button>
        </div>
      </div>

      {/* Global Error Display */}
      {error && (
         <div className="error-state text-center text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 p-4 rounded border border-red-300 dark:border-red-700 mb-4 flex-shrink-0">{error}</div>
      )}

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto pb-4 pr-1">
        {activeTab === 'dashboard' ? (
            <div role="tabpanel" id="dashboard-panel" aria-labelledby="dashboard-tab">
            {/* Quick Actions */}
            <div className="quick-action-bar flex flex-wrap gap-3 mb-6">
                 <button className="quick-action-button text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded shadow flex items-center gap-2 transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => handleQuickAction('start-workspace')} data-shortcut="⌘ W" title="Start Workspace Layout (Cmd+W)" disabled={!userHubPath || isInitializing || workspaceStatus.initialized}>
                <span>🖥️</span> Start Workspace
                </button>
                 <button className="quick-action-button text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 px-3 py-1.5 rounded shadow flex items-center gap-2 border border-gray-300 dark:border-gray-600 transition duration-150 ease-in-out" onClick={() => handleQuickAction('cmd-palette')} data-shortcut="⌘ K" title="Open Command Palette (Cmd+K)">
                <span>⌨️</span> Command Palette
                </button>
                 <button className="quick-action-button text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 px-3 py-1.5 rounded shadow flex items-center gap-2 border border-gray-300 dark:border-gray-600 transition duration-150 ease-in-out" onClick={() => handleQuickAction('new-project')} data-shortcut="⌘ N" title="Create New Project (Cmd+N)">
                <span>➕</span> New Project
                </button>
            </div>

            {/* Main Grid */}
            <div className="dashboard-grid grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Alarms Section */}
                <div className="dashboard-section">
                    <h2 className="section-title text-lg font-semibold mb-3">Alarms</h2>
                    <div className="alarms-container space-y-3">
                        {loadingAlarms ? ( <div className="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">Loading alarms...</div> )
                        : alarms.length > 0 ? (
                            alarms.map((alarm) => {
                                const status = getAlarmStatus(alarm);
                                return (
                                <div key={alarm.id} className={`card alarm-card shadow rounded p-3 border-l-4 ${getAlarmStatusClasses(status)}`} title={`Thresholds: R<=${alarm.thresholds.red}, A<=${alarm.thresholds.amber}, G>${alarm.thresholds.amber}`}>
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-base font-medium flex items-center gap-2">
                                            <span className={`alarm-icon text-lg`}>⏰</span>
                                            {alarm.title}
                                        </h3>
                                        <span className="text-base font-bold flex-shrink-0 ml-2">{alarm.days}d</span>
                                    </div>
                                    {alarm.time && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-7">Due at {alarm.time}</p>}
                                </div>
                                )
                            })
                        ) : (
                            <div className="empty-state text-sm text-gray-500 dark:text-gray-400 p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded text-center">No active alarms.</div>
                        )}
                    </div>
                </div>

                {/* Pinned Docs Section */}
                <div className="dashboard-section">
                    <h2 className="section-title text-lg font-semibold mb-3">Pinned Documents</h2>
                    <DndProvider backend={HTML5Backend}>
                        <div className="pinned-docs-container space-y-2">
                        {loadingPinnedDocs ? ( <div className="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">Loading pinned docs...</div> )
                        : pinnedDocs.length > 0 ? (
                            pinnedDocs.map((doc, index) => (
                            <PinnedDocCard key={doc.id} doc={doc} index={index} moveDoc={moveDoc} togglePin={togglePin} />
                            ))
                        ) : ( <EmptyDocCard /> )}
                        </div>
                    </DndProvider>
                </div>
            </div>
            </div>
        ) : ( // Focus Report Tab
            <div className="focus-report space-y-6" role="tabpanel" id="focus-report-panel" aria-labelledby="focus-report-tab">
            {loadingFocus ? (
                <div className="loading-state text-center text-gray-500 dark:text-gray-400 py-10">Loading focus report...</div>
            ) : focusSummary ? (
                <>
                    {/* Stats Card */}
                    <div className="card focus-stats-card bg-white dark:bg-gray-800 shadow rounded p-4 border border-gray-200 dark:border-gray-700">
                        <h2 className="text-xl font-semibold mb-4">Focus Summary: {today}</h2>
                        <div className="focus-stats grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="stat p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                                <span className="stat-label block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Time</span>
                                <span className="stat-value block text-lg font-bold">{formatTime(focusSummary.totalTime)}</span>
                            </div>
                            <div className="stat p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                                <span className="stat-label block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Focus Score</span>
                                <span className="stat-value block text-lg font-bold">{focusSummary.focusScore ?? 'N/A'}%</span>
                            </div>
                            <div className="stat p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                                <span className="stat-label block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Meetings</span>
                                <span className="stat-value block text-lg font-bold">{formatTime(focusSummary.meetingTime)}</span>
                            </div>
                            <div className="stat p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                                <span className="stat-label block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Window Switches</span>
                                <span className="stat-value block text-lg font-bold">{focusSummary.distractionEvents ?? 'N/A'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Chart Card */}
                    {focusSummary.appBreakdown && focusSummary.appBreakdown.length > 0 ? (
                         <div className="card focus-chart-card bg-white dark:bg-gray-800 shadow rounded p-4 border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold mb-1">Application Breakdown</h3>
                            <div className="focus-chart h-72 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={focusSummary.appBreakdown} cx="50%" cy="50%"
                                        innerRadius="50%" outerRadius="80%"
                                        fill="#8884d8" paddingAngle={2} dataKey="timeSpent" nameKey="appName"
                                        labelLine={false}
                                        // Label only shown for larger slices to prevent overlap
                                        label={({ name, percent }) => percent > 0.03 ? `${name} ${(percent * 100).toFixed(0)}%` : ''}
                                    >
                                    {focusSummary.appBreakdown.map((entry, index) => ( <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} /> ))}
                                    </Pie>
                                    <Tooltip formatter={(value: number, name: string) => [`${formatTime(value)}`, name]} />
                                    <Legend layout="horizontal" verticalAlign="bottom" align="center" iconSize={10} wrapperStyle={{fontSize: '11px', marginTop: '10px'}} />
                                </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    ) : (
                         <div className="card bg-white dark:bg-gray-800 shadow rounded p-4 border border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">No application usage data logged for today.</div>
                    )}


                    {/* Screenshots Card */}
                    <div className="card focus-screenshots-card bg-white dark:bg-gray-800 shadow rounded p-4 border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold mb-3">Recent Screenshots</h3>
                        <div className="screenshot-gallery grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {focusSummary.screenshots && focusSummary.screenshots.length > 0 ? (
                                focusSummary.screenshots.slice(-10).reverse().map((screenshot, index) => ( // Show last 10 newest first
                                <div key={index} className="screenshot-item aspect-video rounded overflow-hidden shadow border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700 relative group">
                                    {/* Use the backend endpoint */}
                                    <img
                                        src={`http://localhost:8000/focus_logs/${screenshot}`}
                                        alt={`Screenshot ${index + 1} from ${today}`}
                                        loading="lazy"
                                        className="w-full h-full object-contain" // Use contain to see whole image
                                        title={screenshot}
                                        onError={(e) => { // Basic placeholder on error
                                            e.currentTarget.style.display = 'none';
                                            const parent = e.currentTarget.parentElement;
                                            if (parent && !parent.querySelector('.placeholder-text')) {
                                                 const placeholder = document.createElement('div');
                                                 placeholder.className = 'placeholder-text absolute inset-0 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-600';
                                                 placeholder.textContent = 'Load Error';
                                                 parent.appendChild(placeholder);
                                            }
                                        }}
                                    />
                                     <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity duration-200">{screenshot}</div>
                                </div>
                                ))
                            ) : (
                                <div className="empty-state col-span-full text-sm text-gray-500 dark:text-gray-400 p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded">No screenshots captured today.</div>
                            )}
                        </div>
                    </div>
                     {/* Keywords Card */}
                     {focusSummary.keywords && focusSummary.keywords.length > 0 && (
                        <div className="card focus-keywords-card bg-white dark:bg-gray-800 shadow rounded p-4 border border-gray-200 dark:border-gray-700">
                             <h3 className="text-lg font-semibold mb-3">Keywords Detected (OCR)</h3>
                             <div className="flex flex-wrap gap-1">
                                 {focusSummary.keywords.slice(0, 50).map((keyword, index) => ( // Limit displayed keywords
                                     <span key={index} className="text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded">{keyword}</span>
                                 ))}
                                  {focusSummary.keywords.length > 50 && <span className="text-xs text-gray-400">...</span>}
                             </div>
                        </div>
                    )}
                </>
            ) : ( // No focus summary available
                <div className="empty-state flex-1 text-center text-gray-500 dark:text-gray-400 py-10 p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                    <p>No focus data available for {today}.</p>
                    <p className="text-sm mt-2">Ensure the Focus Monitor agent is running and generating summaries.</p>
                </div>
            )}
            </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;