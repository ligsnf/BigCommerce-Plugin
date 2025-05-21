# Check if Docker is running
$dockerRunning = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $dockerRunning) {
    Write-Host "Starting Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    # Wait for Docker to start
    Start-Sleep -Seconds 30
}

# Function to check if a port is in use
function Test-PortInUse {
    param($port)
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
        $listener.Start()
        $false
    }
    catch {
        $true
    }
    finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

# Check if ngrok is already running
$ngrokRunning = Get-Process "ngrok" -ErrorAction SilentlyContinue
if (-not $ngrokRunning) {
    Write-Host "Starting ngrok..."
    # Start ngrok in a new window (adjust the port number if needed)
    Start-Process "ngrok" -ArgumentList "http 3000" -WindowStyle Normal
}

# Check if npm process is already running on port 3000
$npmRunning = Test-PortInUse 3000
if (-not $npmRunning) {
    Write-Host "Starting npm run dev..."
    # Start npm in a new window
    Start-Process "powershell" -ArgumentList "-NoExit -Command npm run dev" -WindowStyle Normal
}
else {
    Write-Host "Port 3000 is already in use. Please check if the development server is already running."
}