param(
    [string]$CommandLine = '"C:\Users\Anthony R\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"',
    [string]$WorkingDirectory = "C:\Users\Anthony R\AppData\Local\Programs\DeepSeek Harness"
)

$source = @"
using System;
using System.Runtime.InteropServices;

public class ProcessLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
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
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    public static string Launch(string cmd, string workDir) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = @"WinSta0\Default";

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();

        bool success = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00000200 /* CREATE_NEW_PROCESS_GROUP */, IntPtr.Zero, workDir, ref si, out pi);
        if (!success) {
            return "Failed CreateProcess: " + Marshal.GetLastWin32Error();
        }
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return "Launched PID: " + pi.dwProcessId;
    }
}
"@

Add-Type -TypeDefinition $source
[ProcessLauncher]::Launch($CommandLine, $WorkingDirectory)
