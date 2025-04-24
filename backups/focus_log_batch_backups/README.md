# Focus Log Batch Files Backup

These batch files were previously used to sync focus log data from the FocusTimer directory to the LocalDashboard directory. 

They have been deprecated and removed from the main application as the LocalDashboard application has been modified to read focus logs directly from their source directory:

`C:\Users\admin\Desktop\FocusTimer\focus_logs`

## Files
- `sync_focus_logs.bat` - One-time sync script for focus logs
- `auto_sync_focus_logs.bat` - Continuous sync script (runs every 60 seconds)
- `sync_focus_logs.bat.backup` - Backup copy of one-time sync script
- `auto_sync_focus_logs.bat.backup` - Backup copy of continuous sync script

## Changes Made
1. Modified the backend API (`main.py`) to read logs directly from the FocusTimer directory 
2. Added an endpoint to serve focus log files directly from source
3. Updated `start_dev.bat` to remove references to focus log synchronization
4. Moved these batch files to this backup location for reference

These changes eliminate the need for manual or automated synchronization of focus logs.
