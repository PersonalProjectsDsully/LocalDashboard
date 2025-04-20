import React, { useState, useEffect } from 'react';
import { eventBus } from '../App'; // Assuming eventBus is exported from App.tsx
import { formatDistanceToNow } from 'date-fns'; // For relative time formatting

export interface ActivityItem {
    id?: string; // Optional ID if available from backend
    timestamp: string; // ISO 8601 format string
    type: string; // e.g., 'project_created', 'task_completed', 'document_added', 'workspace_started', 'focus_warning'
    message: string; // Human-readable message
    source?: string; // Optional: 'workspace_agent', 'focus_monitor', 'app'
    data?: Record<string, any>; // Optional structured data
}

interface ActivityFeedProps {
    initialItems?: ActivityItem[]; // Allow passing initial items from parent
}

// Helper function to get icon based on type
const getActivityIcon = (type: string): string => {
    if (type.includes('project')) return '📁'; // Folder for project
    if (type.includes('task')) return '✅'; // Checkmark for task
    if (type.includes('document')) return '📄'; // Document icon
    if (type.includes('workspace')) return '🚀'; // Rocket for workspace start/stop
    if (type.includes('focus') || type.includes('warning')) return '⚠️'; // Warning for focus alerts
    if (type.includes('error')) return '❌'; // Error icon
    if (type.includes('launch')) return '🚀'; // Rocket for launch
     if (type.includes('minimize')) return '➖'; // Minimize icon
    // Add more specific icons as needed
    return '🔔'; // Default bell icon
};

// Helper to format timestamp
const formatTimestamp = (isoString: string): string => {
    try {
        return formatDistanceToNow(new Date(isoString), { addSuffix: true });
    } catch (error) {
        console.error("Error formatting date:", isoString, error);
        return isoString; // Fallback to original string
    }
};

const ActivityFeed: React.FC<ActivityFeedProps> = ({ initialItems = [] }) => {
    const [activities, setActivities] = useState<ActivityItem[]>(initialItems);
    const [maxItems] = useState(50); // Limit the number of items displayed

    useEffect(() => {
        // Listen for WebSocket messages forwarded by the event bus
        const handleWebSocketMessage = (message: any) => {
            // Check if it's an activity log message type from the backend format
            if (message.type === 'activity_log' && message.payload) {
                const newActivity: ActivityItem = {
                    timestamp: message.payload.timestamp || new Date().toISOString(),
                    type: message.payload.type || 'unknown',
                    message: message.payload.message || 'Unknown activity',
                    source: message.payload.source || 'backend', // Identify source if available
                    id: message.payload.id || `activity-${Date.now()}-${Math.random()}` // Generate local ID if none provided
                };

                // Announce the new activity for screen readers
                const announcer = document.getElementById('activity-announcer');
                if (announcer) {
                    announcer.textContent = `New activity: ${newActivity.message}`;
                }

                setActivities(prevActivities => {
                    // Avoid adding duplicates if IDs are provided and match
                    if (newActivity.id && prevActivities.some(act => act.id === newActivity.id)) {
                        return prevActivities;
                    }
                    // Add new activity to the top and limit the total number
                    return [newActivity, ...prevActivities.slice(0, maxItems - 1)];
                });
            }
            // Handle other potential message types if needed
            else if (message.type && message.message) {
                 const newActivity: ActivityItem = {
                    timestamp: message.timestamp || new Date().toISOString(),
                    type: message.type,
                    message: message.message,
                    source: message.source || 'websocket',
                    id: message.id || `activity-${Date.now()}-${Math.random()}`
                 };
                 const announcer = document.getElementById('activity-announcer');
                 if (announcer) {
                    announcer.textContent = `New activity: ${newActivity.message}`;
                 }
                 setActivities(prevActivities => [newActivity, ...prevActivities.slice(0, maxItems - 1)]);
            }
        };

        // Subscribe to the event
        const unsubscribe = eventBus.on('websocket_message', handleWebSocketMessage);

        // Cleanup subscription on unmount
        return () => {
            unsubscribe();
        };
    }, [maxItems]); // Re-run effect if maxItems changes (though it's constant here)

    return (
        <div className="activity-feed-container flex flex-col h-full">
            <h2 className="text-sm font-semibold uppercase p-4 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 tracking-wider sticky top-0 bg-white dark:bg-gray-800 z-10">
                Activity Feed
            </h2>
            {activities.length === 0 ? (
                <div className="flex-grow flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 p-4">
                    No recent activity.
                </div>
            ) : (
                <ul className="flex-grow overflow-y-auto p-4 space-y-3">
                    {activities.map((activity) => (
                        <li key={activity.id || activity.timestamp} className="activity-item flex gap-3">
                            <div className="activity-icon mt-0.5 text-base">
                                {getActivityIcon(activity.type)}
                            </div>
                            <div className="activity-details flex-1 text-xs">
                                <p className="activity-message text-gray-800 dark:text-gray-100 leading-snug">
                                    {activity.message}
                                </p>
                                <div className="activity-meta text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.414L11 10.586V6z" clipRule="evenodd" />
                                    </svg>
                                    <time dateTime={activity.timestamp} title={new Date(activity.timestamp).toLocaleString()}>
                                        {formatTimestamp(activity.timestamp)}
                                    </time>
                                    {activity.source && (
                                        <span className="text-gray-400 dark:text-gray-500 text-[10px] ml-1">({activity.source})</span>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {/* Announcer element for screen readers - placed outside the list */}
             <div id="activity-announcer" className="sr-only" aria-live="polite" aria-atomic="true"></div>
        </div>
    );
};

export default ActivityFeed;