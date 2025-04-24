// migrateLegacyData.ts
// A utility to migrate legacy data formats to the new persistence model

import { saveCountdownToFile } from './AlarmPersistence';

interface LegacyAlarm {
  id: string;
  title: string;
  days: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  time?: string;
  thresholds: {
    red: number;
    amber: number;
    green: number;
  };
  recurrence?: 'once' | 'daily' | 'weekly' | 'monthly';
  status?: 'active' | 'paused' | 'completed';
  targetDate?: string;
}

/**
 * Attempts to migrate any existing legacy alarms from the YAML file or localStorage
 */
export const migrateLegacyData = async (): Promise<boolean> => {
  // Check for data in localStorage first (easiest to migrate)
  try {
    const localStorageData = localStorage.getItem('countdown_data');
    if (localStorageData) {
      const parsedData = JSON.parse(localStorageData);
      
      // If parsedData already has the correct format, no need to migrate
      if (parsedData && Array.isArray(parsedData.alarms)) {
        console.log('LocalStorage data already in correct format');
        return true;
      }
    }
  } catch (e) {
    console.warn('Failed to check localStorage for legacy data:', e);
  }
  
  // Try to load from YAML file (for much older versions)
  try {
    const yamlPath = '../ProjectsHub/countdowns.yaml';
    const yamlContent = await window.fs.readFile(yamlPath, { encoding: 'utf8' });
    
    // Simple YAML parsing logic for the format we expect
    // This is very specific to our YAML format and not a general YAML parser
    if (yamlContent.includes('alarms:')) {
      const alarms: LegacyAlarm[] = [];
      const lines = yamlContent.split('\n');
      
      let currentAlarm: Partial<LegacyAlarm> | null = null;
      
      for (const line of lines) {
        if (line.trim() === 'alarms:' || line.trim() === '- id:') {
          continue;
        }
        
        // New alarm starts
        if (line.trim().startsWith('- id:')) {
          if (currentAlarm && currentAlarm.id) {
            alarms.push(currentAlarm as LegacyAlarm);
          }
          currentAlarm = {};
          const idMatch = line.match(/- id: (.+)/);
          if (idMatch) {
            currentAlarm.id = idMatch[1].trim();
          }
        } 
        // Title
        else if (line.trim().startsWith('title:') && currentAlarm) {
          const titleMatch = line.match(/title: (.+)/);
          if (titleMatch) {
            currentAlarm.title = titleMatch[1].trim();
          }
        }
        // Days
        else if (line.trim().startsWith('days:') && currentAlarm) {
          const daysMatch = line.match(/days: (.+)/);
          if (daysMatch) {
            currentAlarm.days = parseInt(daysMatch[1].trim());
          }
        }
        // Hours
        else if (line.trim().startsWith('hours:') && currentAlarm) {
          const hoursMatch = line.match(/hours: (.+)/);
          if (hoursMatch) {
            currentAlarm.hours = parseInt(hoursMatch[1].trim());
          }
        }
        // Minutes
        else if (line.trim().startsWith('minutes:') && currentAlarm) {
          const minutesMatch = line.match(/minutes: (.+)/);
          if (minutesMatch) {
            currentAlarm.minutes = parseInt(minutesMatch[1].trim());
          }
        }
        // Seconds
        else if (line.trim().startsWith('seconds:') && currentAlarm) {
          const secondsMatch = line.match(/seconds: (.+)/);
          if (secondsMatch) {
            currentAlarm.seconds = parseInt(secondsMatch[1].trim());
          }
        }
        // Thresholds
        else if (line.trim() === 'thresholds:' && currentAlarm) {
          currentAlarm.thresholds = { red: 3, amber: 7, green: 14 };
        }
        // Status (if present)
        else if (line.trim().startsWith('status:') && currentAlarm) {
          const statusMatch = line.match(/status: (.+)/);
          if (statusMatch) {
            const status = statusMatch[1].trim();
            if (status === 'active' || status === 'paused' || status === 'completed') {
              currentAlarm.status = status;
            }
          }
        }
      }
      
      // Add the last alarm if there was one
      if (currentAlarm && currentAlarm.id) {
        alarms.push(currentAlarm as LegacyAlarm);
      }
      
      if (alarms.length > 0) {
        // Convert legacy alarms to new format with targetDates
        const now = new Date();
        const alarmsWithTargetDates = alarms.map(alarm => {
          const targetDate = new Date(now.getTime());
          targetDate.setDate(targetDate.getDate() + (alarm.days || 0));
          targetDate.setHours(targetDate.getHours() + (alarm.hours || 0));
          targetDate.setMinutes(targetDate.getMinutes() + (alarm.minutes || 0));
          targetDate.setSeconds(targetDate.getSeconds() + (alarm.seconds || 0));
          
          return {
            ...alarm,
            targetDate: targetDate.toISOString(),
            status: alarm.status || 'active'
          };
        });
        
        // Save the migrated data
        await saveCountdownToFile(alarmsWithTargetDates);
        console.log(`Migrated ${alarms.length} legacy alarms from YAML`);
        return true;
      }
    }
  } catch (e) {
    console.warn('Failed to migrate from YAML file:', e);
  }
  
  return false;
};
