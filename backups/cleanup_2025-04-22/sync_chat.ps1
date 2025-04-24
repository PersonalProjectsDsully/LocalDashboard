
# This PowerShell script synchronizes chat sessions between direct API calls and UI
# Usage: ./sync_chat.ps1 -sessionId "test123" -messageText "Your message here"

param (
    [Parameter(Mandatory=$true)]
    [string]$sessionId,
    
    [Parameter(Mandatory=$true)]
    [string]$messageText,
    
    [string]$modelId = "llama3.1:8b"
)

# First, send the message to the API with project context
$response = Invoke-RestMethod -Uri "http://localhost:8000/chat/completion" -Method Post -ContentType "application/json" -Body "{
    `"message`": `"$messageText`", 
    `"model_id`": `"$modelId`", 
    `"session_id`": `"$sessionId`",
    `"context_data`": {
        `"include_projects`": true
    }
}"

# Output the response from the LLM
Write-Host "Response from AI:" -ForegroundColor Green
Write-Host $response.content

# Now, ensure the session exists in the UI's store
$existingSessions = $null
try {
    # Check if the session already exists in localStorage
    $localStoragePath = "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\tauri\localStorage.json"
    if (Test-Path $localStoragePath) {
        $localStorage = Get-Content $localStoragePath -Raw | ConvertFrom-Json
        if ($localStorage.chatSessions) {
            $existingSessions = $localStorage.chatSessions | ConvertFrom-Json
        }
    }
    
    if (-not $existingSessions) {
        $existingSessions = @()
    }
    
    # Check if this session already exists
    $sessionExists = $false
    foreach ($session in $existingSessions) {
        if ($session.id -eq $sessionId) {
            $sessionExists = $true
            break
        }
    }
    
    # If not, add it
    if (-not $sessionExists) {
        $newSession = @{
            id = $sessionId
            title = "API Session: $sessionId"
            lastMessage = $messageText.Substring(0, [Math]::Min(50, $messageText.Length))
            lastUpdated = (Get-Date).ToString("o")
        }
        
        $existingSessions += $newSession
        
        # Save back to localStorage
        $localStorage.chatSessions = $existingSessions | ConvertTo-Json -Compress
        $localStorage | ConvertTo-Json -Depth 10 | Set-Content $localStoragePath
        
        Write-Host "Added session to UI storage" -ForegroundColor Cyan
    }
    else {
        Write-Host "Session already exists in UI storage" -ForegroundColor Cyan
    }
    
} catch {
    Write-Host "Warning: Could not update UI session store: $_" -ForegroundColor Yellow
}

Write-Host "Done! You can now see this chat session in the UI by navigating to the Chat page." -ForegroundColor Green