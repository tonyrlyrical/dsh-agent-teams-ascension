Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class ChromeFinder {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }

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

    public static void Find() {
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
                    RECT r;
                    GetWindowRect(hWnd, out r);
                    Console.WriteLine("FOUND TOP on desk '" + d + "': hWnd=0x" + hWnd.ToString("X") + " title='" + title + "' rect=[" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom + "]");
                    EnumChildWindows(hWnd, (child, clp) => {
                        var cb = new StringBuilder(256);
                        GetClassName(child, cb, 256);
                        RECT cr;
                        GetWindowRect(child, out cr);
                        Console.WriteLine("  CHILD: hWnd=0x" + child.ToString("X") + " class='" + cb + "' rect=[" + cr.Left + "," + cr.Top + "," + cr.Right + "," + cr.Bottom + "]");
                        return true;
                    }, IntPtr.Zero);
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
        }
    }
}
'@
[ChromeFinder]::Find()
