import React, { useState, useEffect, useRef } from 'react';

interface ActivityItem {
  id: string;
  type: 'save' | 'git' | 'workspace' | 'focus' | 'alarm';
  message: string;
  timestamp: string;
  read?: boolean;
}

const ActivityFeed: React.FC = () => {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [quietMode, setQuietMode] = useState(false);
  const feedContentRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // This would be replaced with WebSocket connection in the real implementation
    // For now, we'll just use mock data
    const mockActivities: ActivityItem[] = [
      {
        id: '1',
        type: 'save',
        message: 'Saved document "Project Overview"',
        timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
        read: false
      },
      {
        id: '2',
        type: 'git',
        message: 'Auto-committed changes to Git',
        timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
        read: false
      },
      {
        id: '3',
        type: 'workspace',
        message: 'Started workspace "Development"',
        timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
        read: true
      },
      {
        id: '4',
        type: 'focus',
        message: 'Focus Monitor captured 5 screenshots',
        timestamp: new Date(Date.now() - 45 * 60000).toISOString(),
        read: true
      },
      {
        id: '5',
        type: 'alarm',
        message: 'Alarm "Project Deadline" is now amber (10 days left)',
        timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
        read: true
      },
    ];
    
    setActivities(mockActivities);
    
    // In a real implementation, we would set up a WebSocket listener here
    // to receive real-time activity updates
    
    // Simulate new activity arriving every 30 seconds
    const intervalId = setInterval(() => {
      const newActivity: ActivityItem = {
        id: Date.now().toString(),
        type: ['save', 'git', 'workspace', 'focus', 'alarm'][Math.floor(Math.random() * 5)] as any,
        message: `New activity at ${new Date().toLocaleTimeString()}`,
        timestamp: new Date().toISOString(),
        read: false
      };
      
      setActivities(prev => [newActivity, ...prev]);
      
      // Announce new activity for screen readers
      const announcer = document.getElementById('activity-announcer');
      if (announcer) {
        announcer.textContent = `New activity: ${newActivity.message}`;
      }
    }, 30000);
    
    return () => clearInterval(intervalId);
  }, []);
  
  const toggleQuietMode = () => {
    setQuietMode(!quietMode);
  };
  
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffMins < 1440) {
      return `${Math.floor(diffMins / 60)}h ago`;
    } else {
      return `${Math.floor(diffMins / 1440)}d ago`;
    }
  };
  
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'save':
        return '💾';
      case 'git':
        return '📦';
      case 'workspace':
        return '🖥️';
      case 'focus':
        return '📸';
      case 'alarm':
        return '⏰';
      default:
        return '📝';
    }
  };
  
  const handleScroll = () => {
    if (!feedContentRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = feedContentRef.current;
    const scrolledToBottom = scrollTop + clientHeight >= scrollHeight - 50;
    
    if (scrolledToBottom) {
      // Mark all as read when user scrolls to bottom
      setActivities(prev => 
        prev.map(activity => ({ ...activity, read: true }))
      );
    }
  };
  
  return (
    <>
      <div className="feed-header">
        <h2 className="text-lg font-semibold">Activity Feed</h2>
        <button 
          className={`quiet-mode-toggle ${quietMode ? 'active' : ''}`}
          onClick={toggleQuietMode}
          title={quietMode ? 'Disable Quiet Mode' : 'Enable Quiet Mode'}
        >
          {quietMode ? '🔕' : '🔔'}
        </button>
      </div>
      
      <div 
        className="feed-content" 
        ref={feedContentRef}
        onScroll={handleScroll}
      >
        {activities.length > 0 ? (
          activities.map((activity) => (
            <div 
              key={activity.id} 
              className={`activity-item ${activity.type} ${!activity.read ? 'unread' : ''}`}
            >
              <div className="activity-icon">
                {getActivityIcon(activity.type)}
              </div>
              <div className="activity-details">
                <p className="activity-message">{activity.message}</p>
                <span className="activity-time">{formatTimestamp(activity.timestamp)}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <p>No recent activity</p>
          </div>
        )}
      </div>
      
      <div className="feed-footer">
        <button className="clear-feed-btn">Clear All</button>
      </div>
    </>
  );
};

export default ActivityFeed;
