import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import axios from 'axios';
import { eventBus } from '../App'; // Import eventBus

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

const Sidebar: React.FC = () => {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [isFocusMonitorActive, setIsFocusMonitorActive] = useState(true); // Default UI state
  const [loadingAlarms, setLoadingAlarms] = useState(true);
  const [loadingFocusStatus, setLoadingFocusStatus] = useState(true);
  const [error, setError] = useState<string | null>(null);


  const fetchSidebarData = async (isInitial = false) => {
        // Fetch alarms
        if (isInitial || !loadingAlarms) { // Prevent concurrent fetches
            setLoadingAlarms(true);
            try {
                const alarmResponse = await axios.get('http://localhost:8000/alarms');
                setAlarms(alarmResponse.data.alarms || []);
                if (error?.includes('alarms')) setError(null); // Clear specific error on success
            } catch (err) {
                console.error('Error fetching alarms:', err);
                setAlarms([]);
                setError(prev => prev ? `${prev}\nFailed to load alarms.` : 'Failed to load alarms.');
            } finally {
                setLoadingAlarms(false);
            }
        }

        // Fetch focus status (only needed initially, then rely on toggle/WS)
         if (isInitial || !loadingFocusStatus) {
            setLoadingFocusStatus(true);
            try {
                const focusResponse = await axios.get('http://localhost:8000/focus/status');
                const backendState = focusResponse.data.active;
                setIsFocusMonitorActive(backendState);
                if (error?.includes('focus status')) setError(null);
            } catch (err) {
                console.error('Error fetching focus status:', err);
                // Keep UI state as is, maybe show error?
                setError(prev => prev ? `${prev}\nFailed to get focus status.` : 'Failed to get focus status.');
            } finally {
                setLoadingFocusStatus(false);
            }
        }
  };


  useEffect(() => {
    fetchSidebarData(true); // Initial fetch

    // Refresh alarms periodically (e.g., every 5 minutes)
    const intervalId = setInterval(() => fetchSidebarData(false), 5 * 60 * 1000);

    // --- WebSocket Listeners ---
    const handleAlarmUpdate = () => {
         console.log("Alarms updated via WS, refetching...");
         fetchSidebarData(false);
    };
    const handleFocusStatusUpdate = (message: { active: boolean }) => {
         console.log(`Focus status updated via WS: ${message.active}`);
         setIsFocusMonitorActive(message.active);
    };

    const unsubAlarms = eventBus.on('alarms_updated', handleAlarmUpdate);
    const unsubFocus = eventBus.on('focus_status_changed', handleFocusStatusUpdate);

    // Cleanup interval and listeners on component unmount
    return () => {
        clearInterval(intervalId);
        unsubAlarms();
        unsubFocus();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run setup once


  const handleFocusToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newState = event.target.checked;
    // Optimistic update
    setIsFocusMonitorActive(newState);
    setError(null); // Clear error on new action
    try {
      // Send toggle request to backend
      const response = await axios.post('http://localhost:8000/focus/toggle');
      // Update UI with the actual state returned by the backend (in case of race conditions)
      setIsFocusMonitorActive(response.data.active);
    } catch (error) {
      console.error('Failed to toggle focus monitor:', error);
      // Revert UI state on error
      setIsFocusMonitorActive(!newState);
      setError('Failed to toggle Focus Monitor.');
      // Show error notification to user?
    }
  };


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
  }

const getAlarmIcon = (status: string) => {
    // For the add alarm button, the icon is directly implemented rather than using this function
    return '⏰';
  };

  const handleAddAlarm = async () => {
      try {
          // Prompt for alarm details
          const alarmTitle = prompt("Enter alarm title:");
          if (!alarmTitle) return; // User cancelled
          
          const daysTillDue = prompt("Enter days until due:", "30");
          if (!daysTillDue) return; // User cancelled
          
          // Create a new alarm
          const response = await axios.post("http://localhost:8000/alarms", {
              id: `alarm-${Date.now()}`,
              title: alarmTitle,
              days: parseInt(daysTillDue),
              thresholds: {
                  red: 3,  // Default thresholds
                  amber: 7,
                  green: 14
              }
          });
          
          console.log("Created new alarm:", response.data);
          
          // Refresh alarms
          fetchSidebarData(false);
          
      } catch (error) {
          console.error("Failed to create alarm:", error);
          setError("Failed to create alarm. Please try again.");
      }
  }

  return (
    <>
      <div className="sidebar-header mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 tracking-wider">Projects Hub</h1>
      </div>

      {/* Main Navigation */}
      <nav className="sidebar-nav flex-grow space-y-1">
        <NavLink to="/" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
          <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
          </div>
          <span className="truncate">Dashboard</span>
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
          <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          </div>
          <span className="truncate">Projects</span>
        </NavLink>
        <NavLink to="/documents" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
          <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="truncate">Documents</span>
        </NavLink>
        <NavLink to="/tasks" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
          <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="truncate">Tasks</span>
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
          <div className="icon-container w-5 h-5 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="truncate">Chat</span>
        </NavLink>
      </nav>

      {/* Alarms Section */}
      <div className="sidebar-section mt-8">
        <h2 className="text-xs uppercase font-semibold mb-2 text-gray-500 dark:text-gray-400 tracking-wider">Alarms</h2>

         {error && !error.includes('focus status') && /* Show only alarm errors here */
             <div className="text-xs text-red-500 dark:text-red-400 mb-2">{error}</div>
         }

        {loadingAlarms ? (
             <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
        ) : alarms.length > 0 ? (
          <div className="alarms-list space-y-1.5">
            {alarms.slice(0, 5).map((alarm) => { // Limit displayed alarms
                const status = getAlarmStatus(alarm);
                return (
                    <div key={alarm.id} className={`alarm-pill text-xs px-2 py-1 rounded-full flex items-center justify-between gap-2 ${getAlarmPillClasses(status)}`} title={`${alarm.title} - ${alarm.days} days left. Thresholds: R<=${alarm.thresholds.red}, A<=${alarm.thresholds.amber}`}>
                        <div className="flex-shrink-0">{getAlarmIcon(status)}</div>
                        <span className="alarm-title flex-1 truncate">{alarm.title}</span>
                        <span className="alarm-days font-medium flex-shrink-0">{alarm.days}d</span>
                    </div>
                )
            })}
             {alarms.length > 5 && (
                 <div className="text-xs text-center text-gray-500 dark:text-gray-400 mt-1">+ {alarms.length - 5} more</div>
             )}
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400">No alarms set</div>
        )}

        <div className="flex flex-col items-center mt-3">
          <button
              className="add-alarm-btn bg-transparent text-white flex justify-center items-center"
              onClick={handleAddAlarm}
              title="Add New Alarm"
              style={{ border: 'none', outline: 'none', width: '32px', height: '32px' }}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
            </svg>
          </button>
          <span className="text-xs text-white mt-1">Add alarm</span>
        </div>
      </div>

      {/* Footer Section */}
      <div className="sidebar-footer mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="focus-monitor-toggle flex items-center justify-between text-sm text-gray-700 dark:text-gray-200" title={loadingFocusStatus ? "Loading status..." : (isFocusMonitorActive ? "Focus Monitor is ON" : "Focus Monitor is OFF")}>
          <label htmlFor="focus-toggle" className="cursor-pointer select-none flex items-center gap-2">
            <div className="flex-shrink-0" style={{ width: '32px', height: '24px' }}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/>
              </svg>
            </div>
            Focus Monitor
          </label>
          <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
             {loadingFocusStatus ? (
                 <span className="text-xs text-gray-400 italic">...</span>
             ) : (
                 <>
                     <input
                        type="checkbox"
                        name="focus-toggle"
                        id="focus-toggle"
                        className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white dark:bg-gray-400 border-4 appearance-none cursor-pointer border-gray-300 dark:border-gray-500 checked:bg-blue-500 checked:dark:bg-blue-500 checked:border-blue-500 checked:dark:border-blue-500 checked:right-0 transition-all duration-200 ease-in-out"
                        style={{ right: isFocusMonitorActive ? '0' : 'auto' }} // Dynamic positioning
                        checked={isFocusMonitorActive}
                        onChange={handleFocusToggle}
                        disabled={loadingFocusStatus}
                     />
                     <label htmlFor="focus-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 dark:bg-gray-600 cursor-pointer"></label>
                 </>
             )}
          </div>
           {/* Basic toggle styling - can enhance */}
            <style>{`
                #focus-toggle:checked + .toggle-label { background-color: #60A5FA; /* light blue */ }
                .dark #focus-toggle:checked + .toggle-label { background-color: #3B82F6; /* darker blue */ }
            `}</style>
        </div>
         {error && error.includes('focus status') && /* Show focus toggle errors here */
             <div className="text-xs text-red-500 dark:text-red-400 mt-1">{error.replace('Failed to get focus status.','').trim()}</div>
         }
      </div>
    </>
  );
};

export default Sidebar;