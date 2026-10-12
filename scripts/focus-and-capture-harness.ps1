param(
    [string]$OutputPath = "evidence/desktop-validation/screenshots/harness-window-01.png"
)

$source = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;

public class HarnessWindowCapture {
    [DllImport("user32.dll")]
    public static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll")]
    public static extern bool EnumDesktops(IntPtr hwinsta, EnumDesktopProc lpEnumCallback, IntPtr lParam);
    public delegate bool EnumDesktopProc(string lpszDesktop, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    public static string FocusAndCapture(string outputPath) {
        string summary = "";
        Thread t = new Thread(() => {
            try {
                IntPtr hWs = GetProcessWindowStation();
                List<string> desktops = new List<string>();
                EnumDesktops(hWs, (name, lParam) => {
                    desktops.Add(name);
                    return true;
                }, IntPtr.Zero);

                IntPtr foundHwnd = IntPtr.Zero;
                string foundDesk = "";
                string foundTitle = "";
                RECT foundRect = new RECT();

                foreach (string dName in desktops) {
                    IntPtr hDesk = OpenDesktop(dName, 0, false, 0x01FF);
                    if (hDesk == IntPtr.Zero) continue;
                    SetThreadDesktop(hDesk);

                    EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                        if (IsWindowVisible(hWnd)) {
                            uint pid;
                            GetWindowThreadProcessId(hWnd, out pid);
                            var sb = new StringBuilder(256);
                            GetWindowText(hWnd, sb, sb.Capacity);
                            string title = sb.ToString();

                            RECT r;
                            GetWindowRect(hWnd, out r);
                            int w = r.Right - r.Left;
                            int h = r.Bottom - r.Top;

                            bool isDsh = false;
                            try {
                                var p = Process.GetProcessById((int)pid);
                                if (p.ProcessName.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0) isDsh = true;
                            } catch {}

                            if ((title.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0 || isDsh) && w > 400 && h > 300) {
                                foundHwnd = hWnd;
                                foundDesk = dName;
                                foundTitle = string.IsNullOrEmpty(title) ? ("DeepSeek PID " + pid) : title;
                                foundRect = r;
                                return false;
                            }
                        }
                        return true;
                    }, IntPtr.Zero);

                    if (foundHwnd != IntPtr.Zero) {
                        ShowWindow(foundHwnd, 9); // SW_RESTORE
                        SetForegroundWindow(foundHwnd);
                        BringWindowToTop(foundHwnd);
                        Thread.Sleep(500);

                        GetWindowRect(foundHwnd, out foundRect);
                        int width = foundRect.Right - foundRect.Left;
                        int height = foundRect.Bottom - foundRect.Top;

                        if (width > 0 && height > 0) {
                            using (Bitmap bmp = new Bitmap(width, height)) {
                                using (Graphics g = Graphics.FromImage(bmp)) {
                                    IntPtr hdc = g.GetHdc();
                                    bool success = PrintWindow(foundHwnd, hdc, 2);
                                    if (!success) success = PrintWindow(foundHwnd, hdc, 0);
                                    g.ReleaseHdc(hdc);
                                }
                                bmp.Save(outputPath, ImageFormat.Png);
                            }
                            summary = "Captured '" + foundTitle + "' on desktop '" + foundDesk + "' (" + width + "x" + height + ") -> " + outputPath;
                        }
                        CloseDesktop(hDesk);
                        break;
                    }
                    CloseDesktop(hDesk);
                }

                if (foundHwnd == IntPtr.Zero) summary = "No DeepSeek Harness window found on any desktop.";
            } catch (Exception ex) {
                summary = "Error: " + ex.Message;
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return summary;
    }
}
"@

$targetPath = [System.IO.Path]::GetFullPath($OutputPath)
$targetDir = [System.IO.Path]::GetDirectoryName($targetPath)
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing"
$res = [HarnessWindowCapture]::FocusAndCapture($targetPath)
Write-Output $res
