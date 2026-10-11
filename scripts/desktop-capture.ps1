param(
    [string]$OutputPath = "evidence/desktop-validation/screenshots/desktop-live-01.png"
)

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;

public class DefaultDesktopCapture {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public static string CaptureAndList(string outputPath) {
        string summary = "";
        Thread t = new Thread(() => {
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk == IntPtr.Zero) {
                summary = "OpenDesktop failed: " + Marshal.GetLastWin32Error();
                return;
            }
            if (!SetThreadDesktop(hDesk)) {
                summary = "SetThreadDesktop failed: " + Marshal.GetLastWin32Error();
                CloseDesktop(hDesk);
                return;
            }

            var sbList = new StringBuilder();
            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    string title = sb.ToString();
                    uint pid;
                    GetWindowThreadProcessId(hWnd, out pid);
                    if (!string.IsNullOrWhiteSpace(title)) {
                        sbList.AppendLine("PID: " + pid + " | HWND: " + hWnd + " | Title: " + title);
                    }
                }
                return true;
            }, IntPtr.Zero);

            try {
                int w = GetSystemMetrics(0); // SM_CXSCREEN
                int h = GetSystemMetrics(1); // SM_CYSCREEN
                using (Bitmap bmp = new Bitmap(w, h)) {
                    using (Graphics g = Graphics.FromImage(bmp)) {
                        g.CopyFromScreen(0, 0, 0, 0, new Size(w, h));
                    }
                    bmp.Save(outputPath, ImageFormat.Png);
                }
                summary = "Screenshot saved (" + w + "x" + h + ") to " + outputPath + "\n\nWindows:\n" + sbList.ToString();
            } catch (Exception ex) {
                summary = "Screenshot error: " + ex.Message + "\n\nWindows:\n" + sbList.ToString();
            }

            CloseDesktop(hDesk);
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return summary;
    }
}
"@

$targetPath = [System.IO.Path]::GetFullPath($OutputPath)
$dir = [System.IO.Path]::GetDirectoryName($targetPath)
if (-not [System.IO.Directory]::Exists($dir)) {
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
}
Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing"
[DefaultDesktopCapture]::CaptureAndList($targetPath)
