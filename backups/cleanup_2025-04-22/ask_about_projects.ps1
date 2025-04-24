
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
