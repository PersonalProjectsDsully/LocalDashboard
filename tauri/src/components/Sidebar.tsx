import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import axios from 'axios';

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
  
  useEffect(() => {
    // Fetch alarms from the backend
    const fetchAlarms = async () => {
      try {
        const response = await axios.get('http://localhost:8000/alarms');
        setAlarms(response.data.alarms || []);
      } catch (error) {
        console.error('Error fetching alarms:', error);
      }
    };
    
    fetchAlarms();
    
    // Set up interval to refresh alarms every minute
    const intervalId = setInterval(fetchAlarms, 60000);
    
    return () => clearInterval(intervalId);
  }, []);
  
  const getAlarmStatus = (alarm: Alarm) => {
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
    <div className="sidebar">
      <div className="sidebar-header">
        <h1 className="text-xl font-bold mb-6">Projects Hub</h1>
      </div>
      
      <nav className="sidebar-nav">
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">📊</span>
          <span>Dashboard</span>
        </NavLink>
        
        <NavLink to="/projects" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">📁</span>
          <span>Projects</span>
        </NavLink>
        
        <NavLink to="/documents" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">📄</span>
          <span>Documents</span>
        </NavLink>
        
        <NavLink to="/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">✓</span>
          <span>Tasks</span>
        </NavLink>
      </nav>
      
      <div className="sidebar-section mt-8">
        <h2 className="text-sm uppercase font-semibold mb-2 text-gray-400">Alarms</h2>
        
        <div className="alarms-list">
          {alarms.length > 0 ? (
            alarms.map((alarm) => (
              <div key={alarm.id} className={`alarm-pill ${getAlarmStatus(alarm)}`}>
                <span className="alarm-title">{alarm.title}</span>
                <span className="alarm-days">{alarm.days}d</span>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-400">No alarms set</div>
          )}
        </div>
        
        <button className="add-alarm-btn mt-2">
          <span>+</span> Add alarm
        </button>
      </div>
      
      <div className="sidebar-footer mt-auto pt-4">
        <div className="focus-monitor-toggle">
          <label className="switch">
            <input type="checkbox" defaultChecked />
            <span className="slider round"></span>
          </label>
          <span className="ml-2 text-sm">Focus Monitor</span>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
