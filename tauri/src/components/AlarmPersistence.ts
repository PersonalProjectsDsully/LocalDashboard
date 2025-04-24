// AlarmPersistence.ts
// Helper functions for persisting alarm data to files

interface AlarmData {
  id: string;
  targetDate: string;
  status: 'active' | 'paused' | 'completed';
  title: string;
  days: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  thresholds?: {
    red: number;
    amber: number;
    green: number;
  };
}

interface CountdownData {
  alarms: AlarmData[];
  lastUpdated: string;
}

// Paths for persistence file - try multiple locations in case of permission issues
const PERSISTENCE_FILE_PATHS = [
  './alarm_persistence.json',
  '../alarm_persistence.json',
  '../ProjectsHub/alarm_persistence.json',
  '/alarm_persistence.json',
  '../../alarm_persistence.json'
];

// Choose the most appropriate path based on what works
const getPersistenceFilePath = async (): Promise<string> => {
  console.log('Trying to find or create a persistence file...');
  // First, try to see if any of the paths already exist
  for (const path of PERSISTENCE_FILE_PATHS) {
    try {
      console.log(`Trying to read from ${path}...`);
      await window.fs.readFile(path, { encoding: 'utf8' });
      console.log(`Found existing persistence file at ${path}`);
      return path;
    } catch (e) {
      console.warn(`Cannot read from ${path}:`, e);
      // File doesn't exist or can't be read, continue to next path
    }
  }
  
  // If no file exists, try to create one at each path until one works
  for (const path of PERSISTENCE_FILE_PATHS) {
    try {
      console.log(`Trying to create file at ${path}...`);
      await window.fs.writeFile(path, JSON.stringify({ alarms: [], lastUpdated: new Date().toISOString() }));
      console.log(`Created new persistence file at ${path}`);
      return path;
    } catch (e) {
      console.warn(`Failed to create persistence file at ${path}`, e);
    }
  }
  
  // Default to the first path if all else fails
  console.warn('Could not find or create a persistence file, defaulting to first path');
  return PERSISTENCE_FILE_PATHS[0];
};

/**
 * Saves countdown data to a file for persistence across refreshes
 */
export const saveCountdownToFile = async (alarms: AlarmData[]): Promise<boolean> => {
  try {
    // Create the data object with all current alarm data
    const countdownData: CountdownData = {
      alarms,
      lastUpdated: new Date().toISOString()
    };
    
    // Convert to JSON string
    const jsonData = JSON.stringify(countdownData, null, 2);
    
    // Get the appropriate path
    const filePath = await getPersistenceFilePath();
    
    // Save to file
    await window.fs.writeFile(filePath, jsonData);
    console.log(`Countdown data saved to file: ${filePath}`);
    
    // Also save to localStorage as a backup
    localStorage.setItem('countdown_data', jsonData);
    
    return true;
  } catch (error) {
    console.error('Error saving countdown data to file:', error);
    // Make sure we still have localStorage backup
    try {
      const countdownData: CountdownData = {
        alarms,
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem('countdown_data', JSON.stringify(countdownData));
      console.log('Saved to localStorage as backup');
    } catch (e) {
      console.error('Even localStorage backup failed:', e);
    }
    return false;
  }
};

/**
 * Loads countdown data from file
 */
export const loadCountdownFromFile = async (): Promise<AlarmData[] | null> => {
  // Try localStorage first as it's most reliable
  try {
    const localData = localStorage.getItem('countdown_data');
    if (localData) {
      const countdownData: CountdownData = JSON.parse(localData);
      console.log('Countdown data loaded from localStorage');
      return countdownData.alarms;
    }
  } catch (localStorageError) {
    console.error('Error reading from localStorage:', localStorageError);
  }

  // Then try each possible persistence file location
  for (const path of PERSISTENCE_FILE_PATHS) {
    try {
      // Try to read from file
      const fileData = await window.fs.readFile(path, { encoding: 'utf8' });
      
      // Parse JSON data
      const countdownData: CountdownData = JSON.parse(fileData);
      console.log(`Countdown data loaded from file: ${path}`);
      
      // Save to localStorage as backup for next time
      localStorage.setItem('countdown_data', fileData);
      
      return countdownData.alarms;
    } catch (fileError) {
      console.warn(`File read failed from ${path}:`, fileError);
      // Continue to the next path
    }
  }
  
  // Create a new persistence file for next time
  try {
    const filePath = await getPersistenceFilePath();
    console.log(`No data found, created new persistence file at ${filePath} for future use`);
  } catch (e) {
    console.error('Failed to create a new persistence file:', e);
  }
  
  return null;
};

/**
 * Calculates current target dates and remaining times based on saved data and current time
 */
export const recalculateTimesFromPersistence = (alarms: AlarmData[]): AlarmData[] => {
  return alarms.map(alarm => {
    // Only update active alarms
    if (alarm.status === 'active' && alarm.targetDate) {
      const now = new Date();
      const targetDate = new Date(alarm.targetDate);
      
      // Calculate remaining time in seconds
      let diffInSeconds = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 1000));
      
      // Convert to days, hours, minutes, seconds
      const days = Math.floor(diffInSeconds / 86400);
      diffInSeconds %= 86400;
      
      const hours = Math.floor(diffInSeconds / 3600);
      diffInSeconds %= 3600;
      
      const minutes = Math.floor(diffInSeconds / 60);
      const seconds = diffInSeconds % 60;
      
      // Update alarm with calculated values
      return {
        ...alarm,
        days,
        hours,
        minutes,
        seconds
      };
    }
    
    return alarm;
  });
};
