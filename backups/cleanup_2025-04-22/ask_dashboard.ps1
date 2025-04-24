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
