$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot

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
        return $true
    } catch {
        Write-Warning "$Title $Message"
        return $false
    }
}

function Invoke-PythonCommand {
    param([string[]]$Arguments, [switch]$StreamProgress)
    # Windows PowerShell can return every matching application on PATH.
    $pythonPath = (Get-Command python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    # Windows PowerShell 5 treats native stderr as ErrorRecord; collect it without
    # aborting before the native process has completed and supplied its exit code.
    $ErrorActionPreference = "Continue"
    # Native commands update the global automatic variable; a local sentinel
    # would shadow the real exit code and report -1 even after successful runs.
    $global:LASTEXITCODE = -1
    $lines = @(& $pythonPath -X utf8 @Arguments 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($StreamProgress) { Write-Host $line }
        $line
    })
    return [pscustomobject]@{ ExitCode = $global:LASTEXITCODE; Output = $lines }
}

function Write-MonitorFailureReport {
    param([string]$Message)
    $reportDirectory = Join-Path $projectRoot '.tmp\bang-dream-monitor\reports'
    $null = New-Item -ItemType Directory -Path $reportDirectory -Force
    $stamp = (Get-Date -Format 'yyyyMMddTHHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $jsonPath = Join-Path $reportDirectory ($stamp + '.json')
    $htmlPath = Join-Path $reportDirectory ($stamp + '.html')
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $json = @{ run=$stamp; time=[DateTimeOffset]::Now.ToString('o'); errors=@($Message); notifications=@() } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($jsonPath, $json, $encoding)
    $html = "<!doctype html><meta charset='utf-8'><title>官网监控失败</title><h1>官网监控失败</h1><pre>" + [System.Net.WebUtility]::HtmlEncode($Message) + '</pre>'
    [System.IO.File]::WriteAllText($htmlPath, $html, $encoding)
    Write-Host ("官网监控失败报告：" + $htmlPath)
}

function Invoke-DailyMaintenance {
    param(
        [scriptblock]$BackupAction,
        [scriptblock]$MonitorAction,
        [scriptblock]$NotifyAction,
        [scriptblock]$AckAction
    )
    $failed = $false
    try {
        $backup = & $BackupAction
    } catch {
        $backup = [pscustomobject]@{ ExitCode = 1; Output = @($_.Exception.Message) }
    }
    $summary = Get-NotificationMessage -Lines $backup.Output
    Write-Host $summary
    if ($backup.ExitCode -eq 0) {
        $null = & $NotifyAction "LiveSetList 自动备份成功" $summary "Info"
    } else {
        $failed = $true
        $level = if ($summary -match "异常偏低") { "Warning" } else { "Error" }
        $null = & $NotifyAction "LiveSetList 自动备份失败" $summary $level
        Write-Host ($backup.Output | Out-String)
    }

    # The monitor always follows the completed backup attempt, including failures.
    try {
        $monitor = & $MonitorAction
        if ($monitor.ExitCode -ne 0) { $failed = $true }
        $result = @($monitor.Output | Where-Object { $_.Trim() })[-1] | ConvertFrom-Json
        if ($result.notify) {
            $level = if ($result.errors -gt 0) { "Warning" } else { "Info" }
            $shown = & $NotifyAction "BanG Dream 官网监控" $result.summary $level
            if ($shown -and $result.ack_report -and $result.changes -gt 0) {
                $ack = & $AckAction $result.ack_report
                if ($ack.ExitCode -ne 0) { $failed = $true }
            } elseif (-not $shown) {
                $failed = $true
            }
        }
        Write-Host ("官网监控报告：" + $result.report)
    } catch {
        $failed = $true
        $failureMessage = $_.Exception.Message
        try { Write-MonitorFailureReport -Message $failureMessage } catch { Write-Warning $_.Exception.Message }
        $null = & $NotifyAction "BanG Dream 官网监控失败" $failureMessage "Error"
    }
    if ($failed) { return 1 }
    return 0
}

# Dot-sourcing exposes the orchestration for behavioral tests without running a backup.
if ($MyInvocation.InvocationName -ne '.') {
    Set-Location $projectRoot
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $OutputEncoding = [Console]::OutputEncoding
    $resultCode = Invoke-DailyMaintenance -BackupAction {
        Invoke-PythonCommand -Arguments @('scripts/recovery_db.py', 'backup-app-auto')
    } -MonitorAction {
        Invoke-PythonCommand -Arguments @('scripts/bang_dream_monitor.py') -StreamProgress
    } -NotifyAction {
        param($title, $message, $level)
        Show-BackupNotification -Title $title -Message $message -Level $level
    } -AckAction {
        param($report)
        Invoke-PythonCommand -Arguments @('scripts/bang_dream_monitor.py', '--ack-report', $report)
    }
    exit $resultCode
}
