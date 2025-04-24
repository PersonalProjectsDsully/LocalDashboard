def _update_alarm_legacy(alarm):
    """Legacy method to update alarms without targetDate."""
    # For active alarms, reduce days
    if alarm.get("status") != "completed":
        # Update time values
        seconds = alarm.get("seconds", 0) - 1
        
        if seconds < 0:
            seconds = 59
            minutes = alarm.get("minutes", 0) - 1
            
            if minutes < 0:
                minutes = 59
                hours = alarm.get("hours", 0) - 1
                
                if hours < 0:
                    hours = 23
                    days = alarm.get("days", 0) - 1
                    
                    if days < 0:
                        days = 0
                        hours = 0
                        minutes = 0
                        seconds = 0
                else:
                    days = alarm.get("days", 0)
            else:
                hours = alarm.get("hours", 0)
                days = alarm.get("days", 0)
        else:
            minutes = alarm.get("minutes", 0)
            hours = alarm.get("hours", 0)
            days = alarm.get("days", 0)
        
        # Update alarm values
        alarm["days"] = days
        alarm["hours"] = hours
        alarm["minutes"] = minutes
        alarm["seconds"] = seconds
        
        # Check if countdown reached zero
        if days <= 0 and hours <= 0 and minutes <= 0 and seconds <= 0:
            # For one-time alarms, mark as completed
            if not alarm.get("recurrence") or alarm.get("recurrence") == "once":
                alarm["status"] = "completed"
                alarm["days"] = 0
                alarm["hours"] = 0
                alarm["minutes"] = 0
                alarm["seconds"] = 0
            # For recurring alarms, reset the days based on recurrence type
            else:
                recurrence = alarm.get("recurrence")
                if recurrence == "daily":
                    alarm["days"] = 1
                    # Also update the targetDate for better persistence
                    from datetime import datetime, timezone, timedelta
                    new_target = datetime.now(timezone.utc) + timedelta(days=1)
                    alarm["targetDate"] = new_target.isoformat()
                elif recurrence == "weekly":
                    alarm["days"] = 7
                    # Also update the targetDate for better persistence
                    from datetime import datetime, timezone, timedelta
                    new_target = datetime.now(timezone.utc) + timedelta(days=7)
                    alarm["targetDate"] = new_target.isoformat()
                elif recurrence == "monthly":
                    alarm["days"] = 30
                    # Also update the targetDate for better persistence
                    from datetime import datetime, timezone, timedelta
                    new_target = datetime.now(timezone.utc) + timedelta(days=30)
                    alarm["targetDate"] = new_target.isoformat()
                alarm["hours"] = 0
                alarm["minutes"] = 0
                alarm["seconds"] = 0