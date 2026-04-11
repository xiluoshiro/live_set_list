$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = "D:\Code\PythonCode\5 LiveSetList"

function Get-NotificationMessage {
    param(
        [object[]]$Lines
    )

    $summary = @($Lines) |
        ForEach-Object { $_.ToString().Trim() } |
        Where-Object { $_ } |
        Select-Object -Last 1

    if (-not $summary) {
        return "未捕获到备份摘要。"
    }

    $singleLine = $summary -replace "\s+", " "
    if ($singleLine.Length -gt 240) {
        return $singleLine.Substring(0, 237) + "..."
    }
    return $singleLine
}

function Show-BackupNotification {
    param(
        [string]$Title,
        [string]$Message,
        [ValidateSet("Info", "Warning", "Error")]
        [string]$Level = "Info"
    )

    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing

        $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
        $notifyIcon.Icon = switch ($Level) {
            "Error" { [System.Drawing.SystemIcons]::Error }
            "Warning" { [System.Drawing.SystemIcons]::Warning }
            default { [System.Drawing.SystemIcons]::Information }
        }
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::$Level
        $notifyIcon.BalloonTipTitle = $Title
        $notifyIcon.BalloonTipText = $Message
        $notifyIcon.Visible = $true
        $notifyIcon.ShowBalloonTip(10000)
        Start-Sleep -Seconds 10
        $notifyIcon.Dispose()
    } catch {
        Write-Output "$Title $Message"
    }
}

Set-Location $projectRoot

try {
    $output = & python scripts/recovery_db.py backup-app-auto 2>&1
    $exitCode = $LASTEXITCODE
} catch {
    $message = $_.Exception.Message
    Show-BackupNotification -Title "LiveSetList 自动备份失败" -Message $message -Level "Error"
    throw
}

$summary = Get-NotificationMessage -Lines $output
if ($exitCode -eq 0) {
    Show-BackupNotification -Title "LiveSetList 自动备份成功" -Message $summary -Level "Info"
    exit 0
}

$level = if ($summary -match "异常偏低") { "Warning" } else { "Error" }
Show-BackupNotification -Title "LiveSetList 自动备份失败" -Message $summary -Level $level
Write-Output ($output | Out-String)
exit $exitCode
