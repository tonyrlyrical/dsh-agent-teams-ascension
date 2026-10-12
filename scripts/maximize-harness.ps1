Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WindowMaximizer {
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
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    public static void Maximize() {
        var desktops = new List<string>();
        IntPtr hwinsta = OpenWindowStation("WinSta0", false, 0x037F);
        if (hwinsta != IntPtr.Zero) {
            EnumDesktops(hwinsta, (desk, lp) => { desktops.Add(desk); return true; }, IntPtr.Zero);
        }

        foreach (string d in desktops) {
            IntPtr hDesk = OpenDesktop(d, 0, false, 0x01FF);
            if (hDesk == IntPtr.Zero) continue;
            SetThreadDesktop(hDesk);
            EnumDesktopWindows(hDesk, (hWnd, lp) => {
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (title.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0) {
                    ShowWindow(hWnd, 3); // SW_MAXIMIZE
                    SetForegroundWindow(hWnd);
                    BringWindowToTop(hWnd);
                    Console.WriteLine("Maximized " + hWnd + " on desktop " + d);
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
        }
    }
}
'@
[WindowMaximizer]::Maximize()
