import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

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

const Dashboard: React.FC = () => {
  const [focusSummary, setFocusSummary] = useState<FocusSummary | null>(null);
  const [alarms, setAlarms] = useState<any[]>([]);
  const [pinnedDocs, setPinnedDocs] = useState<any[]>([]);
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
          { id: '1', title: 'Project Overview', path: 'Project-A/docs/overview.md' },
          { id: '2', title: 'Meeting Notes', path: 'Project-B/docs/meeting-notes.md' },
          { id: '3', title: 'Development Roadmap', path: 'Project-A/docs/roadmap.md' },
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
  
  return (
    <div className="dashboard-container">
      <div className="header">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={`tab ${activeTab === 'focus-report' ? 'active' : ''}`}
            onClick={() => setActiveTab('focus-report')}
          >
            Focus Report
          </button>
        </div>
      </div>
      
      {activeTab === 'dashboard' ? (
        <>
          <div className="quick-action-bar">
            <button className="quick-action-button">
              <span>🖥️</span> Start Workspace
            </button>
            <button className="quick-action-button">
              <span>⌘</span> Command Palette
            </button>
            <button className="quick-action-button">
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
                        <h3 className="text-lg font-semibold">{alarm.title}</h3>
                        <span className="text-lg font-bold">{alarm.days}d</span>
                      </div>
                      {alarm.time && <p className="text-sm text-gray-500">Due: {alarm.time}</p>}
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No alarms set</div>
                )}
              </div>
            </div>
            
            <div className="dashboard-section">
              <h2 className="section-title">Pinned Documents</h2>
              <div className="pinned-docs-container">
                {pinnedDocs.length > 0 ? (
                  pinnedDocs.map((doc) => (
                    <div key={doc.id} className="card doc-card">
                      <h3 className="text-lg font-semibold">{doc.title}</h3>
                      <p className="text-sm text-gray-500">{doc.path}</p>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No pinned documents</div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="focus-report">
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
