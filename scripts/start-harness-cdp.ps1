param(
    [int]$CdpPort = 9222
)

# 1. Stop existing DeepSeek Harness processes
Write-Output "Stopping existing DeepSeek Harness instances..."
Get-Process | Where-Object { $_.ProcessName -like "*harness*" -or $_.ProcessName -like "*deepseek*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 2. Compile Win32 CreateProcess launcher targeting WinSta0\Default
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class DesktopLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize;
        public int dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation
    );

    public static int Launch(string appPath, string args, string desktop) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = desktop;

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        string cmd = "\"" + appPath + "\" " + args;

        bool ok = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi);
        if (!ok) {
            int err = Marshal.GetLastWin32Error();
            throw new Exception("CreateProcess failed with error code: " + err);
        }
        return pi.dwProcessId;
    }
}
'@

$appPath = "C:\Users\Anthony R\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
$args = "--remote-debugging-port=$CdpPort"
$procId = [DesktopLauncher]::Launch($appPath, $args, "WinSta0\Default")
Write-Output "Launched DeepSeek Harness with PID $procId on WinSta0\Default with --remote-debugging-port=$CdpPort"

# 3. Wait for port to open
$started = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    $listening = Get-NetTCPConnection -LocalPort $CdpPort -ErrorAction SilentlyContinue
    if ($listening) {
        $started = $true
        Write-Output "CDP listening on port $CdpPort!"
        break
    }
}

if (-not $started) {
    Write-Output "Warning: CDP port did not open after 15 seconds."
}
