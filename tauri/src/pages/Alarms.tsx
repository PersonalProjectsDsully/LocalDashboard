import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { eventBus } from '../App';
import { 
  Clock, 
  Plus, 
  Edit, 
  Trash2, 
  Play, 
  Pause, 
  Repeat, 
  ChevronDown, 
  ChevronUp, 
  Calendar, 
  AlertCircle 
} from 'lucide-react';

// Import functions from AlarmPersistence.ts
import { saveCountdownToFile, loadCountdownFromFile, recalculateTimesFromPersistence } from '../components/AlarmPersistence';
import { migrateLegacyData } from '../components/migrateLegacyData';

// Types
interface Alarm {
  id: string;
  title: string;
  days: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  time?: string;
  thresholds?: {
    red: number;
    amber: number;
    green: number;
  };
  recurrence?: 'once' | 'daily' | 'weekly' | 'monthly';
  status?: 'active' | 'paused' | 'completed';
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  daysOfWeek?: number[]; // 0-6 (Sunday to Saturday)
  lastUpdated?: string;
  targetDate?: string; // ISO date string for the target date/time
}

interface AlarmFormData {
  title: string;
  days: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly';
  daysOfWeek: number[];
  status: 'active' | 'paused' | 'completed';
}

// Helper components
const AlarmCard: React.FC<{ 
  alarm: Alarm; 
  onEdit: (alarm: Alarm) => void; 
  onDelete: (id: string) => void;
  onToggleStatus: (id: string, newStatus: 'active' | 'paused' | 'completed') => void;
}> = ({ alarm, onEdit, onDelete, onToggleStatus }) => {
  const [expanded, setExpanded] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  }>({ days: alarm.days || 0, hours: alarm.hours || 0, minutes: alarm.minutes || 0, seconds: alarm.seconds || 0 });
  
  // Update countdown in real-time
  useEffect(() => {
    // Only run countdown for active alarms
    if (alarm.status === 'paused' || alarm.status === 'completed') {
      return;
    }
    
    // Always prioritize targetDate for reliable persistence
    let targetDate: Date | null = null;
    
    // Set initial time state from alarm values
    if (alarm.targetDate) {
      // If we have a targetDate, use it to calculate the current remaining time
      targetDate = new Date(alarm.targetDate);
      const now = new Date();
      const diff = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 1000));
      
      // Convert seconds to days, hours, minutes, seconds
      const days = Math.floor(diff / 86400);
      const hours = Math.floor((diff % 86400) / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      
      setTimeRemaining({ days, hours, minutes, seconds });
    } else {
      // No targetDate available, use the provided time values
      setTimeRemaining({ 
        days: alarm.days || 0, 
        hours: alarm.hours || 0, 
        minutes: alarm.minutes || 0, 
        seconds: alarm.seconds || 0 
      });
    }
    
    // Start the timer
    const timer = setInterval(() => {
      if (targetDate) {
        // Always calculate based on the fixed target date for consistent persistence
        const now = new Date();
        const diff = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 1000));
        
        // Convert seconds to days, hours, minutes, seconds
        const days = Math.floor(diff / 86400);
        const hours = Math.floor((diff % 86400) / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;
        
        setTimeRemaining({ days, hours, minutes, seconds });
      } else {
        // Fallback local countdown mode (less accurate, avoid if possible)
        setTimeRemaining(prev => {
          // Calculate total seconds
          let totalSeconds = (prev.days * 86400) + (prev.hours * 3600) + (prev.minutes * 60) + prev.seconds;
          
          // Decrement by 1 second
          totalSeconds = Math.max(0, totalSeconds - 1);
          
          // Convert back to days, hours, minutes, seconds
          const days = Math.floor(totalSeconds / 86400);
          const hours = Math.floor((totalSeconds % 86400) / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;
          
          return { days, hours, minutes, seconds };
        });
      }
    }, 1000);
    
    return () => clearInterval(timer);
  }, [alarm.status, alarm.targetDate, alarm.days, alarm.hours, alarm.minutes, alarm.seconds]);
  
  // Format time as DD:HH:MM:SS
  const formatTime = (time: { days: number; hours: number; minutes: number; seconds: number }) => {
    return `${String(time.days).padStart(2, '0')}:${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:${String(time.seconds).padStart(2, '0')}`;
  };

  // Sync countdown time with backend and update persistence file
  const syncCountdownWithBackend = useCallback(async (updatedTime: { days: number; hours: number; minutes: number; seconds: number }) => {
    if (alarm.status === 'paused' || alarm.status === 'completed') {
      return;
    }
    
    try {
      // Create a local updated alarm object
      const updatedAlarm = {
        ...alarm,
        days: updatedTime.days,
        hours: updatedTime.hours,
        minutes: updatedTime.minutes,
        seconds: updatedTime.seconds,
        // Ensure the targetDate is also updated to maintain correctness across refreshes
        targetDate: (() => {
          const now = new Date();
          const targetDate = new Date(now.getTime());
          targetDate.setDate(targetDate.getDate() + updatedTime.days);
          targetDate.setHours(targetDate.getHours() + updatedTime.hours);
          targetDate.setMinutes(targetDate.getMinutes() + updatedTime.minutes);
          targetDate.setSeconds(targetDate.getSeconds() + updatedTime.seconds);
          return targetDate.toISOString();
        })()
      };
      
      // Update the backend
      await axios.put(`http://localhost:8000/alarms/${alarm.id}`, updatedAlarm);
      
      // Notify parent component via the onToggleStatus handler
      // We pass the entire updated alarm to ensure the parent has the latest data
      onToggleStatus(alarm.id, 'active');
    } catch (error) {
      console.error('Error syncing countdown with backend:', error);
    }
  }, [alarm, onToggleStatus]);

  // Sync time to backend periodically 
  useEffect(() => {
    if (alarm.status === 'paused' || alarm.status === 'completed') {
      return;
    }
    
    // More frequent syncing to ensure persistence is reliable
    const syncInterval = setInterval(() => {
      syncCountdownWithBackend(timeRemaining);
    }, 15000); // 15 seconds
    
    return () => clearInterval(syncInterval);
  }, [alarm.status, timeRemaining, syncCountdownWithBackend]);
  
  // Calculate total seconds remaining
  const calculateTotalSeconds = () => {
    const days = alarm.days || 0;
    const hours = alarm.hours || 0;
    const minutes = alarm.minutes || 0;
    const seconds = alarm.seconds || 0;
    
    return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
  };
  
  // Calculate percentage of time remaining
  const calculateProgress = () => {
    const totalSeconds = calculateTotalSeconds();
    // Calculate total seconds based on initial values
    const initialDays = alarm.days || 0;
    const initialHours = alarm.hours || 0;
    const initialMinutes = alarm.minutes || 0;
    const initialSeconds = alarm.seconds || 0;
    const initialTotalSeconds = (initialDays * 86400) + (initialHours * 3600) + (initialMinutes * 60) + initialSeconds;
    // Use the initial total as the max (100%)
    const maxSeconds = Math.max(initialTotalSeconds, 3600); // At least 1 hour for visual purposes
    return Math.min(100, Math.max(0, (totalSeconds / maxSeconds) * 100));
  };
  
  // Get status color class
  const getStatusColor = () => {
    // Calculate total time in days
    const totalTimeInDays = alarm.days + (alarm.hours || 0) / 24 + (alarm.minutes || 0) / 1440 + (alarm.seconds || 0) / 86400;
    
    // Simple color logic without thresholds
    if (totalTimeInDays < 1) return 'bg-red-500'; // Less than 1 day
    if (totalTimeInDays < 7) return 'bg-yellow-500'; // Less than 1 week
    return 'bg-green-500'; // 1 week or more
  };
  
  // Format based on recurrence
  const getRecurrenceText = () => {
    switch (alarm.recurrence) {
      case 'daily': return 'Resets daily';
      case 'weekly': return 'Resets weekly';
      case 'monthly': return 'Resets monthly';
      default: return 'One-time alarm';
    }
  };
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center">
          <div className={`w-3 h-3 rounded-full mr-3 ${getStatusColor()}`} />
          <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200">{alarm.title}</h3>
        </div>
        <div className="flex items-center space-x-2">
          {alarm.status === 'active' ? (
            <button 
              onClick={() => onToggleStatus(alarm.id, 'paused')}
              className="p-1 text-gray-500 hover:text-blue-500 dark:text-gray-400 dark:hover:text-blue-400"
              title="Pause countdown"
            >
              <Pause size={16} />
            </button>
          ) : (
            <button 
              onClick={() => onToggleStatus(alarm.id, 'active')}
              className="p-1 text-gray-500 hover:text-green-500 dark:text-gray-400 dark:hover:text-green-400"
              title="Resume countdown"
            >
              <Play size={16} />
            </button>
          )}
          <button 
            onClick={() => onEdit(alarm)}
            className="p-1 text-gray-500 hover:text-blue-500 dark:text-gray-400 dark:hover:text-blue-400"
            title="Edit alarm"
          >
            <Edit size={16} />
          </button>
          <button 
            onClick={() => onDelete(alarm.id)}
            className="p-1 text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
            title="Delete alarm"
          >
            <Trash2 size={16} />
          </button>
          <button 
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            title={expanded ? "Show less" : "Show more"}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      
      <div className="mb-4">
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
          <div 
            className={`h-2.5 rounded-full ${getStatusColor()}`} 
            style={{ width: `${calculateProgress()}%` }}
          ></div>
        </div>
      </div>
      
      <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center">
          <Clock size={14} className="mr-1" />
          <span className="font-mono">{formatTime(timeRemaining)}</span>
        </div>
        <div className="flex items-center">
          <Repeat size={14} className="mr-1" />
          <span>{getRecurrenceText()}</span>
        </div>
      </div>
      
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-sm">
          <div>
            <p className="text-gray-500 dark:text-gray-400 mb-1">Details</p>
            <p className="text-gray-600 dark:text-gray-300 mb-1">Status: {alarm.status}</p>
            {alarm.startDate && (
              <p className="text-gray-600 dark:text-gray-300 mb-1">Started: {alarm.startDate}</p>
            )}
            {alarm.recurrence === 'weekly' && alarm.daysOfWeek && alarm.daysOfWeek.length > 0 && (
              <p className="text-gray-600 dark:text-gray-300 mb-1">
                Days: {alarm.daysOfWeek.map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')}
              </p>
            )}
            <div className="flex items-center mt-2">
              <p className="text-gray-600 dark:text-gray-300 mr-2">Color indicators:</p>
              <div className="flex items-center ml-2">
                <div className="w-2 h-2 rounded-full bg-red-500 mr-1"></div>
                <span className="text-gray-600 dark:text-gray-300 text-xs mr-2">Less than 1 day</span>
                <div className="w-2 h-2 rounded-full bg-yellow-500 mr-1"></div>
                <span className="text-gray-600 dark:text-gray-300 text-xs mr-2">Less than 1 week</span>
                <div className="w-2 h-2 rounded-full bg-green-500 mr-1"></div>
                <span className="text-gray-600 dark:text-gray-300 text-xs">1 week or more</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Modal component for adding/editing alarms
const AlarmModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: AlarmFormData) => void;
  initialData?: Alarm;
  isEditing: boolean;
}> = ({ isOpen, onClose, onSave, initialData, isEditing }) => {
  const [formData, setFormData] = useState<AlarmFormData>({
    title: '',
    days: 0,
    hours: 1,
    minutes: 0,
    seconds: 0,
    recurrence: 'once',
    daysOfWeek: [],
    status: 'active'
  });
  
  // Initialize form with alarm data when editing
  useEffect(() => {
    if (initialData) {
      setFormData({
        title: initialData.title,
        days: initialData.days,
        hours: initialData.hours || 0,
        minutes: initialData.minutes || 0,
        seconds: initialData.seconds || 0,
        recurrence: initialData.recurrence || 'once',
        daysOfWeek: initialData.daysOfWeek || [],
        status: initialData.status || 'active'
      });
    }
  }, [initialData, isOpen]);
  
  // Reset form when closing
  useEffect(() => {
    if (!isOpen && !isEditing) {
      setFormData({
        title: '',
        days: 0,
        hours: 1,
        minutes: 0,
        seconds: 0,
        recurrence: 'once',
        daysOfWeek: [],
        status: 'active'
      });
    }
  }, [isOpen, isEditing]);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    if (name === 'days') {
      // Update days
      const days = parseInt(value);
      setFormData({
        ...formData,
        days
      });
    } else if (name === 'hours' || name === 'minutes' || name === 'seconds') {
      // Handle time fields
      const numValue = parseInt(value);
      const fieldName = name as 'hours' | 'minutes' | 'seconds';
      
      // Apply appropriate limits
      let limitedValue = numValue;
      if (fieldName === 'hours' && numValue > 23) limitedValue = 23;
      if ((fieldName === 'minutes' || fieldName === 'seconds') && numValue > 59) limitedValue = 59;
      if (numValue < 0) limitedValue = 0;
      
      setFormData({
        ...formData,
        [fieldName]: limitedValue
      });
    } else {
      setFormData({
        ...formData,
        [name]: name === 'days' ? parseInt(value) : value
      });
    }
  };
  
  const handleDayOfWeekToggle = (day: number) => {
    const currentDays = [...formData.daysOfWeek];
    const index = currentDays.indexOf(day);
    
    if (index === -1) {
      currentDays.push(day);
    } else {
      currentDays.splice(index, 1);
    }
    
    setFormData({
      ...formData,
      daysOfWeek: currentDays
    });
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
          {isEditing ? 'Edit Alarm' : 'Create New Alarm'}
        </h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              value={formData.title}
              onChange={handleInputChange}
              placeholder="Alarm title"
              required
            />
          </div>
          
          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">
              Time until due
            </label>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-xs mb-1" htmlFor="days">
                  Days
                </label>
                <input
                  id="days"
                  name="days"
                  type="number"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  value={formData.days}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-xs mb-1" htmlFor="hours">
                  Hours
                </label>
                <input
                  id="hours"
                  name="hours"
                  type="number"
                  min="0"
                  max="23"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  value={formData.hours}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-xs mb-1" htmlFor="minutes">
                  Minutes
                </label>
                <input
                  id="minutes"
                  name="minutes"
                  type="number"
                  min="0"
                  max="59"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  value={formData.minutes}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-xs mb-1" htmlFor="seconds">
                  Seconds
                </label>
                <input
                  id="seconds"
                  name="seconds"
                  type="number"
                  min="0"
                  max="59"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  value={formData.seconds}
                  onChange={handleInputChange}
                />
              </div>
            </div>
          </div>
          
          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2" htmlFor="recurrence">
              Recurrence
            </label>
            <select
              id="recurrence"
              name="recurrence"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              value={formData.recurrence}
              onChange={handleInputChange}
            >
              <option value="once">One-time</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          
          {formData.recurrence === 'weekly' && (
            <div className="mb-4">
              <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">
                Days of Week
              </label>
              <div className="flex flex-wrap gap-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleDayOfWeekToggle(index)}
                    className={`px-3 py-1 rounded-full text-sm ${
                      formData.daysOfWeek.includes(index)
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              {formData.daysOfWeek.length === 0 && (
                <p className="text-red-500 text-xs mt-1">Please select at least one day</p>
              )}
            </div>
          )}
          
          {/* Thresholds section removed */}
          
          <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="mr-2 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 focus:outline-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none"
              disabled={formData.recurrence === 'weekly' && formData.daysOfWeek.length === 0}
            >
              {isEditing ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Empty state component
const EmptyState: React.FC<{ onCreateAlarm: () => void }> = ({ onCreateAlarm }) => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-white dark:bg-gray-800 rounded-lg shadow">
    <Clock size={64} className="text-gray-400 dark:text-gray-500 mb-4" />
    <h3 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">No alarms yet</h3>
    <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
      Create alarms to track important deadlines and events. You can set one-time or recurring alarms.
    </p>
    <button
      onClick={onCreateAlarm}
      className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
    >
      <Plus size={18} className="mr-2" />
      Create your first alarm
    </button>
  </div>
);

// Main component
const Alarms: React.FC = () => {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentAlarm, setCurrentAlarm] = useState<Alarm | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  // Function to persist the countdown timing information to file
  const persistCountdownData = useCallback(async () => {
    try {
      // Create a data object with all alarm details for persistence
      const persistData = alarms.map(a => {
        const data: any = {
          id: a.id,
          title: a.title,
          targetDate: a.targetDate,
          status: a.status,
          days: a.days,
          hours: a.hours,
          minutes: a.minutes,
          seconds: a.seconds,
        };
        
        // Include thresholds if they exist
        if (a.thresholds) {
          data.thresholds = a.thresholds;
        } else {
          // Add default thresholds for API compatibility
          data.thresholds = {
            red: 1,
            amber: 3,
            green: 7
          };
        }
        
        return data;
      });
      
      // Save to file and localStorage
      await saveCountdownToFile(persistData);
    } catch (error) {
      console.error('Error persisting countdown data:', error);
    }
  }, [alarms]);
  
  // Save countdown data whenever alarms change
  useEffect(() => {
    if (alarms.length > 0) {
      // Use direct saveCountdownToFile for simplicity
      saveCountdownToFile(alarms).catch(error => {
        console.error('Error auto-persisting alarm changes:', error);
      });
    }
  }, [alarms]);
  
  // Load persisted data on initial component mount
  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        // Attempt to migrate legacy data first
        await migrateLegacyData();
        
        // Now try to load the persisted data (possibly just migrated)
        let persistedAlarms = null;
        try {
          persistedAlarms = await loadCountdownFromFile();
        } catch (persistError) {
          console.error('Error loading from persistence file during initial load:', persistError);
        }
        
        if (persistedAlarms && persistedAlarms.length > 0) {
          console.log('Loaded persisted alarms:', persistedAlarms);
          
          // Recalculate current times based on target dates
          const updatedAlarms = recalculateTimesFromPersistence(persistedAlarms);
          
          // Update alarms state with persisted data
          setAlarms(updatedAlarms);
          setLoading(false);
        } else {
          // If we couldn't load persisted alarms, fetch from API
          try {
            console.log('No persisted alarms, fetching from API during init');
            const response = await axios.get('http://localhost:8000/alarms');
            const alarmsData = response.data.alarms || [];
            console.log('Loaded alarms from API during init:', alarmsData);
            setAlarms(alarmsData);
            setLoading(false);
            
            // Try to persist this data
            if (alarmsData.length > 0) {
              saveCountdownToFile(alarmsData).catch(error => {
                console.error('Error persisting API data during init:', error);
              });
            }
          } catch (apiError) {
            console.error('Error fetching alarms from API during init:', apiError);
          }
        }
      } catch (error) {
        console.error('Error loading persisted alarm data:', error);
      }
    };
    
    loadPersistedData();
  }, []);
  
  // Fetch alarms
  const fetchAlarms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Try to load from persisted data first
      let persistedAlarms = null;
      try {
        persistedAlarms = await loadCountdownFromFile();
      } catch (persistError) {
        console.error('Error loading from persistence file:', persistError);
      }
      
      if (persistedAlarms && persistedAlarms.length > 0) {
        // We have persisted data, use that
        console.log('Using persisted alarm data');
        const updatedAlarms = recalculateTimesFromPersistence(persistedAlarms);
        setAlarms(updatedAlarms);
      } else {
        // No persisted data, fetch from API
        console.log('No persisted data or persistence failed, fetching from API');
        try {
          const response = await axios.get('http://localhost:8000/alarms');
          const alarmsData = response.data.alarms || [];
          console.log('Loaded alarms from API:', alarmsData);
          setAlarms(alarmsData);
          
          // Persist this data
          if (alarmsData.length > 0) {
            saveCountdownToFile(alarmsData).catch(error => {
              console.error('Error persisting API data:', error);
            });
          }
        } catch (apiError) {
          console.error('Error fetching alarms from API:', apiError);
          setError('Failed to load alarms from API. Please try again.');
          setAlarms([]);
        }
      }
    } catch (err) {
      console.error('Error in fetchAlarms:', err);
      setError('Failed to load alarms. Please try again.');
      setAlarms([]);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Initialize
  useEffect(() => {
    // Don't use the loading initial load, let the separate load function handle initial loading
    // This is just for event setup and later refreshes
    const handleAlarmUpdate = () => {
      console.log('Alarms updated via WebSocket, refetching...');
      fetchAlarms();
    };
    
    // Listen for WebSocket messages indicating alarm updates
    const unsubscribe = eventBus.on('alarms_updated', handleAlarmUpdate);
    
    // Cleanup listener on component unmount
    return () => unsubscribe();
  }, [fetchAlarms]);
  
  // Open modal for creating a new alarm
  const handleCreateAlarm = () => {
    setCurrentAlarm(null);
    setIsEditing(false);
    setIsModalOpen(true);
  };
  
  // Open modal for editing an alarm
  const handleEditAlarm = (alarm: Alarm) => {
    setCurrentAlarm(alarm);
    setIsEditing(true);
    setIsModalOpen(true);
  };
  
  // Delete an alarm
  const handleDeleteAlarm = async (id: string) => {
    setError(null);
    try {
      await axios.delete(`http://localhost:8000/alarms/${id}`);
      // Optimistically update UI
      setAlarms(prevAlarms => {
        const filteredAlarms = prevAlarms.filter(alarm => alarm.id !== id);
        
        // Update persistence with the filtered alarms
        saveCountdownToFile(filteredAlarms).catch(persistError => {
          console.error('Error persisting after delete:', persistError);
        });
        
        return filteredAlarms;
      });
    } catch (err) {
      console.error('Error deleting alarm:', err);
      setError('Failed to delete alarm. Please try again.');
      // Refetch to ensure UI is in sync with backend
      fetchAlarms();
    }
  };
  
  // Toggle alarm status
  const handleToggleStatus = async (id: string, newStatus: 'active' | 'paused' | 'completed') => {
    setError(null);
    try {
      // Find the alarm to update
      const alarmToUpdate = alarms.find(alarm => alarm.id === id);
      if (!alarmToUpdate) return;
      
      // Create updated alarm object
      const updatedAlarm = { ...alarmToUpdate, status: newStatus };
      
      // If this is a synchronization call from the AlarmCard component
      // and the status is already active, we should update the time values but not change the status
      if (newStatus === 'active' && alarmToUpdate.status === 'active') {
        // This is likely a sync call, not a toggle
        // Just update our state with the latest values from the alarm card
        setAlarms(prevAlarms => {
          const updatedAlarms = prevAlarms.map(alarm => alarm.id === id ? updatedAlarm : alarm);
          
          // Update persistence
          saveCountdownToFile(updatedAlarms).catch(persistError => {
            console.error('Error persisting after time sync:', persistError);
          });
          
          return updatedAlarms;
        });
        return;
      }
      
      // Otherwise, this is a real status toggle
      // Send update to backend
      await axios.put(`http://localhost:8000/alarms/${id}`, updatedAlarm);
      
      // Optimistically update UI
      setAlarms(prevAlarms => {
        const updatedAlarms = prevAlarms.map(alarm => alarm.id === id ? updatedAlarm : alarm);
        
        // Update persistence
        saveCountdownToFile(updatedAlarms).catch(persistError => {
          console.error('Error persisting after status update:', persistError);
        });
        
        return updatedAlarms;
      });
    } catch (err) {
      console.error('Error updating alarm status:', err);
      setError('Failed to update alarm status. Please try again.');
      // Refetch to ensure UI is in sync with backend
      fetchAlarms();
    }
  };
  
  // Calculate target date based on time values (for countdown purposes)
  const calculateTargetDate = (formData: AlarmFormData) => {
    const now = new Date();
    const targetDate = new Date(now.getTime());
    targetDate.setDate(targetDate.getDate() + (formData.days || 0));
    targetDate.setHours(targetDate.getHours() + (formData.hours || 0));
    targetDate.setMinutes(targetDate.getMinutes() + (formData.minutes || 0));
    targetDate.setSeconds(targetDate.getSeconds() + (formData.seconds || 0));
    return targetDate;
  };
  
  // Handle window/tab close to ensure data is saved
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Sync one final time before the page unloads
      persistCountdownData();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [persistCountdownData]);

  // Save a new alarm or update an existing one
  const handleSaveAlarm = async (formData: AlarmFormData) => {
    setError(null);
    try {
      // Calculate target date for countdown
      const targetDate = calculateTargetDate(formData);
      
      // Prepare alarm data with default thresholds for API compatibility
      const alarmData: any = {
        ...formData,
        startDate: new Date().toISOString().split('T')[0],
        lastUpdated: new Date().toISOString(),
        targetDate: targetDate.toISOString(),
        // Add default thresholds for API compatibility
        thresholds: {
          red: 1,
          amber: 3,
          green: 7
        }
      };
      
      if (isEditing && currentAlarm) {
        // Update existing alarm
        await axios.put(`http://localhost:8000/alarms/${currentAlarm.id}`, {
          ...alarmData,
          id: currentAlarm.id
        });
        
        // Update UI
        const updatedAlarm = { ...currentAlarm, ...alarmData, id: currentAlarm.id };
        setAlarms(prevAlarms => {
          const updatedAlarms = prevAlarms.map(alarm => 
            alarm.id === currentAlarm.id ? updatedAlarm : alarm
          );
          
          // Save updated data to file
          saveCountdownToFile(updatedAlarms).catch(error => {
            console.error('Error persisting after alarm update:', error);
          });
          
          return updatedAlarms;
        });
      } else {
        // Create new alarm
        const response = await axios.post('http://localhost:8000/alarms', {
          ...alarmData,
          id: `alarm-${Date.now()}`
        });
        
        // Add to UI
        setAlarms(prevAlarms => {
          const updatedAlarms = [...prevAlarms, response.data];
          
          // Save updated data to file
          saveCountdownToFile(updatedAlarms).catch(error => {
            console.error('Error persisting after adding new alarm:', error);
          });
          
          return updatedAlarms;
        });
      }
      
      // Close modal
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error saving alarm:', err);
      setError('Failed to save alarm. Please try again.');
    }
  };
  
  // Update countdown for all alarms (manual trigger)
  const handleUpdateCountdowns = async () => {
    setError(null);
    try {
      // First save the current state of all alarms
      // This ensures we don't lose our current countdown values
      for (const alarm of alarms) {
        if (alarm.status !== 'paused' && alarm.status !== 'completed') {
          try {
            await axios.put(`http://localhost:8000/alarms/${alarm.id}`, alarm);
          } catch (err) {
            console.error(`Error saving current state for alarm ${alarm.id}:`, err);
          }
        }
      }
      
      // Then trigger the backend countdown update
      await axios.post('http://localhost:8000/alarms/update-countdowns');
      // Refetch to get updated values
      fetchAlarms();
    } catch (err) {
      console.error('Error updating countdowns:', err);
      setError('Failed to update countdowns. Please try again.');
    }
  };
  
  return (
    <div className="alarms-container p-4 md:p-6 lg:p-8 w-full h-full flex flex-col">
      <div className="header flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Alarms</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
            Track important deadlines with customizable countdowns
          </p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={handleUpdateCountdowns}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded shadow hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center"
            title="Manually update all countdowns"
          >
            <Calendar size={16} className="mr-2" />
            <span>Update Countdowns</span>
          </button>
          <button
            onClick={handleCreateAlarm}
            className="px-4 py-2 bg-blue-500 text-white rounded shadow hover:bg-blue-600 transition-colors flex items-center"
          >
            <Plus size={16} className="mr-2" />
            <span>New Alarm</span>
          </button>
        </div>
      </div>
      
      {/* Error notification */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md flex items-center">
          <AlertCircle size={18} className="mr-2 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      
      {/* Loading state */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-2">
          {alarms.length === 0 ? (
            <EmptyState onCreateAlarm={handleCreateAlarm} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {alarms.map(alarm => (
                <AlarmCard 
                  key={alarm.id} 
                  alarm={alarm} 
                  onEdit={handleEditAlarm} 
                  onDelete={handleDeleteAlarm}
                  onToggleStatus={handleToggleStatus}
                />
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Modal for adding/editing alarms */}
      <AlarmModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveAlarm}
        initialData={currentAlarm || undefined}
        isEditing={isEditing}
      />
    </div>
  );
};

export default Alarms;