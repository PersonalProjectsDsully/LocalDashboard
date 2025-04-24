/**
 * Centralized Unused Functions
 * This file contains functions that were previously defined in various files
 * but are not actively used in the codebase. They're kept here for reference.
 */

// From App.tsx - unused location-related variables/logic
import { useLocation } from 'react-router-dom';
function AppLocationRelated() {
  const location = useLocation();
  // Any location-related logic that was removed
}

// From CommandPalette.tsx - unused imports that were removed
import { ActionImpl, ActionId, createAction } from 'kbar';

// An example of how ActionImpl and ActionId might have been used
function handleActionImplementation(action: ActionImpl) {
  const actionId: ActionId = action.id;
  console.log(`Handling action: ${actionId}`);
}

// Example of the createAction usage that was removed
function createUnusedAction(id, name) {
  return createAction({
    id,
    name,
    // other properties
  });
}

// From focus_monitor_agent.py - commented out code about admin privileges check
function checkAdminPrivileges() {
  // Python code for checking admin privileges
  // import ctypes
  // try:
  //      is_admin = os.getuid() == 0 # Linux check
  // except AttributeError:
  //      is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0 # Windows check
  // if not is_admin:
  //     logger.warning("Script not running with admin privileges. Some window operations might fail.")
}

// From Command Palette - TODO actions that were not implemented
const unimplementedCommandPaletteActions = [
  {
    id: 'createNewProject',
    name: 'Create New Project',
    shortcut: ['n', 'p'],
    keywords: 'new project create add',
    section: 'Actions',
    perform: () => {
      // Implementation would go here
    },
  },
  {
    id: 'createNewTask',
    name: 'Create New Task',
    shortcut: ['n', 't'],
    keywords: 'new task create add',
    section: 'Actions',
    perform: () => {
      // Implementation would go here
    },
  },
  {
    id: 'createNewDocument',
    name: 'Create New Document',
    shortcut: ['n', 'd'],
    keywords: 'new document create add',
    section: 'Actions',
    perform: () => {
      // Implementation would go here
    },
  },
  {
    id: 'activateWorkspace',
    name: 'Activate Project Workspace',
    shortcut: ['a', 'w'],
    keywords: 'activate workspace project setup windows',
    section: 'Actions',
    perform: () => {
      // Implementation would go here
    },
  },
  {
    id: 'searchProjects',
    name: 'Search Projects',
    shortcut: ['s', 'p'],
    keywords: 'search find projects filter',
    section: 'Search',
    perform: () => {
      // Implementation would go here
    },
  },
  {
    id: 'searchTasks',
    name: 'Search Tasks',
    shortcut: ['s', 't'],
    keywords: 'search find tasks filter',
    section: 'Search',
    perform: () => {
      // Implementation would go here
    },
  },
  {
    id: 'searchDocuments',
    name: 'Search Documents',
    shortcut: ['s', 'd'],
    keywords: 'search find documents filter',
    section: 'Search',
    perform: () => {
      // Implementation would go here
    },
  },
];

// From workspace_snap_agent.py
function checkIsAdmin() {
  // import ctypes
  // try:
  //      is_admin = os.getuid() == 0 # Linux check
  // except AttributeError:
  //      is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0 # Windows check
  // if not is_admin:
  //     logger.warning("Script not running with admin privileges. Some window operations might fail.")
}

// From removed PowerShell scripts

// From ask_about_projects.ps1
// PowerShell function to ask questions about projects
/*
# Helper script to ask questions about projects
# Usage: ./ask_about_projects.ps1 -question "What are my current projects?"

param (
    [Parameter(Mandatory=$true)]
    [string]$question,
    
    [string]$sessionId = "projects-chat",
    [string]$modelId = "llama3.1:8b"
)

Write-Host "Asking: $question" -ForegroundColor Cyan

# Send request with projects context enabled
$response = Invoke-RestMethod -Uri "http://localhost:8000/chat/completion" -Method Post -ContentType "application/json" -Body "{
    `"message`": `"$question`", 
    `"model_id`": `"$modelId`", 
    `"session_id`": `"$sessionId`",
    `"context_data`": {
        `"include_projects`": true
    }
}"

# Display the response
Write-Host "`nResponse from AI:" -ForegroundColor Green
Write-Host "$($response.content)" -ForegroundColor White
*/

// From ask_dashboard.ps1
// PowerShell function to communicate with dashboard assistant
/*
# Comprehensive dashboard assistant script
# Usage: ./ask_dashboard.ps1 -question "What tasks do I have due this week?"

param (
    [Parameter(Mandatory=$true)]
    [string]$question,
    
    [string]$sessionId = "dashboard-assistant",
    [string]$modelId = "llama3.1:8b",
    
    [switch]$includeProjects = $true,
    [switch]$includeTasks = $true,
    [switch]$includeDocuments = $true,
    [switch]$includeDocumentContent = $false
)

Write-Host "Dashboard Assistant" -ForegroundColor Blue
Write-Host "Question: $question" -ForegroundColor Cyan
Write-Host "Including context data:" -ForegroundColor Gray
if ($includeProjects) { Write-Host "  - Projects" -ForegroundColor Gray }
if ($includeTasks) { Write-Host "  - Tasks" -ForegroundColor Gray }
if ($includeDocuments) { Write-Host "  - Documents" -ForegroundColor Gray }
if ($includeDocumentContent) { Write-Host "  - Document Content (previews)" -ForegroundColor Gray }

# Build context data object
$contextData = @{
    include_projects = [bool]$includeProjects
    include_tasks = [bool]$includeTasks
    include_documents = [bool]$includeDocuments
    include_document_content = [bool]$includeDocumentContent
}

# Build the full request body object
$requestBody = @{
    message = $question
    model_id = $modelId
    session_id = $sessionId
    context_data = $contextData
}

# Convert the entire request to JSON
$jsonBody = $requestBody | ConvertTo-Json -Depth 10

try {
    # Make the API call with proper JSON
    $response = Invoke-RestMethod -Uri "http://localhost:8000/chat/completion" -Method Post -ContentType "application/json" -Body $jsonBody

    # Display the response
    Write-Host "`nResponse from Assistant:" -ForegroundColor Green
    Write-Host "$($response.content)" -ForegroundColor White
}
catch {
    Write-Host "`nError communicating with the backend:" -ForegroundColor Red
    Write-Host "$_" -ForegroundColor Red
    
    # Additional debug info
    Write-Host "`nRequest body was:" -ForegroundColor Yellow
    Write-Host $jsonBody -ForegroundColor Yellow
    
    # Offer troubleshooting steps
    Write-Host "`nTroubleshooting tips:" -ForegroundColor Yellow
    Write-Host "1. Make sure the backend server is running (check docker-compose)" -ForegroundColor Yellow
    Write-Host "2. If the backend is running but unreachable, check for network issues" -ForegroundColor Yellow
    Write-Host "3. The JSON formatting may be incorrect - check the output above" -ForegroundColor Yellow
}
*/

// From sync_chat.ps1
// PowerShell script for syncing chat sessions
/*
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
    $localStoragePath = "C:\\Users\\admin\\Desktop\\LocalDashboard\\LocalDashboard\\tauri\\localStorage.json"
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
*/
