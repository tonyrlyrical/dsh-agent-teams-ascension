Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class DesktopSwitcher {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenWindowStation(string a, bool b, uint c);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktops(IntPtr a, EnumDesktopsDelegate b, IntPtr c);
    public delegate bool EnumDesktopsDelegate(string a, IntPtr b);
    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string a, int b, bool c, uint d);
    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr a);
    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr a);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr a, EnumWindowsProc b, IntPtr c);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool SwitchDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    public static string SwitchToHarness() {
        var desktops = new List<string>();
        IntPtr hwinsta = OpenWindowStation("WinSta0", false, 0x037F);
        if (hwinsta != IntPtr.Zero) {
            EnumDesktops(hwinsta, (desk, lp) => { desktops.Add(desk); return true; }, IntPtr.Zero);
        }

        string targetDesk = null;
        IntPtr targetHwnd = IntPtr.Zero;

        foreach (string d in desktops) {
            IntPtr hDesk = OpenDesktop(d, 0, false, 0x01FF);
            if (hDesk == IntPtr.Zero) continue;
            SetThreadDesktop(hDesk);
            EnumDesktopWindows(hDesk, (hWnd, lp) => {
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (title.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0) {
                    targetDesk = d;
                    targetHwnd = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
            if (targetHwnd != IntPtr.Zero) break;
        }

        if (targetDesk == null) return "DeepSeek Harness window not found on any desktop";

        IntPtr switchHDesk = OpenDesktop(targetDesk, 0, false, 0x01FF);
        if (switchHDesk == IntPtr.Zero) return "Failed to open desktop " + targetDesk;

        SetThreadDesktop(switchHDesk);
        ShowWindow(targetHwnd, 9); // SW_RESTORE
        SetForegroundWindow(targetHwnd);
        BringWindowToTop(targetHwnd);

        bool switched = SwitchDesktop(switchHDesk);
        int err = Marshal.GetLastWin32Error();
        CloseDesktop(switchHDesk);

        return "Harness found on desktop '" + targetDesk + "'. Focus set and SwitchDesktop result: " + switched + (switched ? " (Success)" : (" (Error: " + err + ")"));
    }
}
'@

$res = [DesktopSwitcher]::SwitchToHarness()
Write-Output $res
