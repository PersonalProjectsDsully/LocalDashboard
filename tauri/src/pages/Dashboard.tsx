import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

interface FocusSummary {
  date: string;
  totalTime: number;
  appBreakdown: {
    appName: string;
    timeSpent: number;
    percentage: number;
  }[];
  screenshots: string[];
  keywords: string[];
}

interface PinnedDoc {
  id: string;
  title: string;
  path: string;
  lastModified?: string;
}

interface DragItem {
  type: string;
  id: string;
  index: number;
}

const ItemTypes = {
  PINNED_DOC: 'pinnedDoc',
};

const PinnedDocCard: React.FC<{
  doc: PinnedDoc;
  index: number;
  moveDoc: (dragIndex: number, hoverIndex: number) => void;
  togglePin: (id: string) => void;
}> = ({ doc, index, moveDoc, togglePin }) => {
  const ref = useRef<HTMLDivElement>(null);
  
  const [{ isDragging }, drag] = useDrag({
    type: ItemTypes.PINNED_DOC,
    item: { type: ItemTypes.PINNED_DOC, id: doc.id, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });
  
  const [, drop] = useDrop({
    accept: ItemTypes.PINNED_DOC,
    hover: (item: DragItem, monitor) => {
      if (!ref.current) {
        return;
      }
      
      const dragIndex = item.index;
      const hoverIndex = index;
      
      // Don't replace items with themselves
      if (dragIndex === hoverIndex) {
        return;
      }
      
      // Determine rectangle on screen
      const hoverBoundingRect = ref.current.getBoundingClientRect();
      
      // Get vertical middle
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      
      // Determine mouse position
      const clientOffset = monitor.getClientOffset();
      
      // Get pixels to the top
      const hoverClientY = clientOffset!.y - hoverBoundingRect.top;
      
      // Only perform the move when the mouse has crossed half of the items height
      // When dragging downwards, only move when the cursor is below 50%
      // When dragging upwards, only move when the cursor is above 50%
      
      // Dragging downwards
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }
      
      // Dragging upwards
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }
      
      // Time to actually perform the action
      moveDoc(dragIndex, hoverIndex);
      
      // Note: we're mutating the monitor item here!
      // Generally it's better to avoid mutations,
      // but it's good here for the sake of performance
      // to avoid expensive index searches.
      item.index = hoverIndex;
    },
  });
  
  drag(drop(ref));
  
  const opacity = isDragging ? 0.4 : 1;
  
  // Determine file icon based on path extension
  const getFileIcon = (path: string) => {
    const extension = path.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'md':
        return '📄';
      case 'pdf':
        return '📕';
      case 'doc':
      case 'docx':
        return '📘';
      case 'xls':
      case 'xlsx':
        return '📗';
      case 'ppt':
      case 'pptx':
        return '📙';
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return '🖼️';
      default:
        return '📄';
    }
  };
  
  return (
    <div 
      ref={ref} 
      className="card doc-card" 
      style={{ opacity }}
    >
      <div className="doc-icon">
        {getFileIcon(doc.path)}
      </div>
      <div className="doc-content">
        <h3 className="doc-title">{doc.title}</h3>
        <p className="doc-path">{doc.path}</p>
        {doc.lastModified && (
          <p className="doc-last-modified">
            Last modified: {format(new Date(doc.lastModified), 'MMM d, yyyy h:mm a')}
          </p>
        )}
      </div>
      <div className="doc-actions">
        <span 
          className={`pin-button ${true ? 'pinned' : ''}`}
          onClick={() => togglePin(doc.id)}
          title="Unpin document"
        >
          ★
        </span>
      </div>
    </div>
  );
};

const EmptyDocCard: React.FC = () => {
  return (
    <div className="empty-doc-card">
      Drag files here to pin
    </div>
  );
};

const Dashboard: React.FC = () => {
  const [focusSummary, setFocusSummary] = useState<FocusSummary | null>(null);
  const [alarms, setAlarms] = useState<any[]>([]);
  const [pinnedDocs, setPinnedDocs] = useState<PinnedDoc[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const today = format(new Date(), 'yyyy-MM-dd');
  
  useEffect(() => {
    // Fetch focus summary for today
    const fetchFocusSummary = async () => {
      try {
        const response = await axios.get(`http://localhost:8000/focus/summary?date=${today}`);
        setFocusSummary(response.data);
      } catch (error) {
        console.error('Error fetching focus summary:', error);
      }
    };
    
    // Fetch alarms
    const fetchAlarms = async () => {
      try {
        const response = await axios.get('http://localhost:8000/alarms');
        setAlarms(response.data.alarms || []);
      } catch (error) {
        console.error('Error fetching alarms:', error);
      }
    };
    
    // Fetch pinned docs
    const fetchPinnedDocs = async () => {
      try {
        // This would be replaced with actual API call when implemented
        setPinnedDocs([
          { 
            id: '1', 
            title: 'Project Overview', 
            path: 'Project-A/docs/overview.md',
            lastModified: '2025-04-18T14:30:00Z'
          },
          { 
            id: '2', 
            title: 'Meeting Notes', 
            path: 'Project-B/docs/meeting-notes.md',
            lastModified: '2025-04-15T10:00:00Z'
          },
          { 
            id: '3', 
            title: 'Development Roadmap', 
            path: 'Project-A/docs/roadmap.md',
            lastModified: '2025-04-10T09:15:00Z'
          },
        ]);
      } catch (error) {
        console.error('Error fetching pinned docs:', error);
      }
    };
    
    fetchFocusSummary();
    fetchAlarms();
    fetchPinnedDocs();
  }, [today]);
  
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];
  
  const getAlarmStatus = (alarm: any) => {
    const daysLeft = alarm.days;
    
    if (daysLeft <= alarm.thresholds.red) {
      return 'red';
    } else if (daysLeft <= alarm.thresholds.amber) {
      return 'amber';
    } else {
      return 'green';
    }
  };

  const getAlarmIcon = (status: string) => {
    switch (status) {
      case 'red':
        return '🔔';
      case 'amber':
        return '🔔';
      case 'green':
        return '🔔';
      default:
        return '🔔';
    }
  };
  
  const moveDoc = (dragIndex: number, hoverIndex: number) => {
    const draggedDoc = pinnedDocs[dragIndex];
    const newDocs = [...pinnedDocs];
    newDocs.splice(dragIndex, 1);
    newDocs.splice(hoverIndex, 0, draggedDoc);
    setPinnedDocs(newDocs);
  };
  
  const togglePin = (id: string) => {
    // In a real app, this would call an API to toggle the pin status
    console.log('Toggle pin for doc:', id);
  };
  
  return (
    <div className="dashboard-container">
      <div className="header">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="tabs" role="tablist">
          <button 
            className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
            role="tab"
            aria-selected={activeTab === 'dashboard'}
            aria-controls="dashboard-panel"
            id="dashboard-tab"
          >
            Dashboard
          </button>
          <button 
            className={`tab ${activeTab === 'focus-report' ? 'active' : ''}`}
            onClick={() => setActiveTab('focus-report')}
            role="tab"
            aria-selected={activeTab === 'focus-report'}
            aria-controls="focus-report-panel"
            id="focus-report-tab"
          >
            Focus Report
          </button>
        </div>
      </div>
      
      {activeTab === 'dashboard' ? (
        <div role="tabpanel" id="dashboard-panel" aria-labelledby="dashboard-tab">
          <div className="quick-action-bar">
            <button className="quick-action-button" data-shortcut="⌘ W">
              <span>🖥️</span> Start Workspace
            </button>
            <button className="quick-action-button" data-shortcut="⌘ ⇧ P">
              <span>⌘</span> Command Palette
            </button>
            <button className="quick-action-button" data-shortcut="⌘ N">
              <span>+</span> New Project
            </button>
          </div>
          
          <div className="dashboard-grid">
            <div className="dashboard-section">
              <h2 className="section-title">Alarms</h2>
              <div className="alarms-container">
                {alarms.length > 0 ? (
                  alarms.map((alarm) => (
                    <div key={alarm.id} className={`card alarm-card ${getAlarmStatus(alarm)}`}>
                      <div className="flex justify-between items-center">
                        <h3 className="text-lg font-semibold">
                          <span className={`alarm-icon ${getAlarmStatus(alarm)}`}>
                            {getAlarmIcon(getAlarmStatus(alarm))}
                          </span>
                          {alarm.title}
                        </h3>
                        <span className="text-lg font-bold">{alarm.days}d</span>
                      </div>
                      {alarm.time && <p className="text-sm text-gray-500">Due: {alarm.time}</p>}
                      <div className="alarm-progress">
                        <div 
                          className={`alarm-progress-bar ${getAlarmStatus(alarm)}`} 
                          style={{ width: `${Math.min(10, alarm.days) * 10}%` }}
                        ></div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No alarms set</div>
                )}
              </div>
            </div>
            
            <div className="dashboard-section">
              <h2 className="section-title">Pinned Documents</h2>
              <DndProvider backend={HTML5Backend}>
                <div className="pinned-docs-container">
                  {pinnedDocs.length > 0 ? (
                    pinnedDocs.map((doc, index) => (
                      <PinnedDocCard 
                        key={doc.id} 
                        doc={doc} 
                        index={index}
                        moveDoc={moveDoc}
                        togglePin={togglePin}
                      />
                    ))
                  ) : (
                    <EmptyDocCard />
                  )}
                </div>
              </DndProvider>
            </div>
          </div>
        </div>
      ) : (
        <div className="focus-report" role="tabpanel" id="focus-report-panel" aria-labelledby="focus-report-tab">
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Focus Summary for {today}</h2>
            
            {focusSummary ? (
              <>
                <div className="focus-stats mb-4">
                  <div className="stat">
                    <span className="stat-label">Total Focus Time</span>
                    <span className="stat-value">{Math.round(focusSummary.totalTime / 60)} minutes</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Top Application</span>
                    <span className="stat-value">
                      {focusSummary.appBreakdown[0]?.appName || 'None'}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Keywords</span>
                    <div className="keywords">
                      {focusSummary.keywords.slice(0, 5).map((keyword, index) => (
                        <span key={index} className="keyword">{keyword}</span>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="focus-chart">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={focusSummary.appBreakdown}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="timeSpent"
                        nameKey="appName"
                      >
                        {focusSummary.appBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any) => `${Math.round(value / 60)} min`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                <h3 className="text-lg font-semibold mt-6 mb-2">Screenshots</h3>
                <div className="screenshot-gallery">
                  {focusSummary.screenshots.length > 0 ? (
                    focusSummary.screenshots.map((screenshot, index) => (
                      <div key={index} className="screenshot-item">
                        <img src={`http://localhost:8000/focus_logs/${screenshot}`} alt={`Screenshot ${index + 1}`} />
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No screenshots available</div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">No focus data available for today</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
