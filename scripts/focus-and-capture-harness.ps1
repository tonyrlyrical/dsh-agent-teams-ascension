param(
    [string]$OutputPath = "evidence/desktop-validation/screenshots/harness-window-01.png"
)

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;

public class HarnessWindowCapture {
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

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public static string FocusAndCapture(string outputPath) {
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

            IntPtr targetHwnd = IntPtr.Zero;
            string targetTitle = "";
            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    uint pid;
                    GetWindowThreadProcessId(hWnd, out pid);
                    var sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    string title = sb.ToString();

                    RECT winRect;
                    GetWindowRect(hWnd, out winRect);
                    int w = winRect.Right - winRect.Left;
                    int h = winRect.Bottom - winRect.Top;

                    bool isDsh = false;
                    try {
                        var p = Process.GetProcessById((int)pid);
                        if (p.ProcessName.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0) {
                            isDsh = true;
                        }
                    } catch {}

                    if ((title.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0 || isDsh) && w > 400 && h > 300) {
                        targetHwnd = hWnd;
                        targetTitle = string.IsNullOrEmpty(title) ? ("DeepSeek PID " + pid) : title;
                        return false;
                    }
                }
                return true;
            }, IntPtr.Zero);

            if (targetHwnd == IntPtr.Zero) {
                summary = "No DeepSeek Harness window found.";
                CloseDesktop(hDesk);
                return;
            }

            // Restore and bring to foreground
            ShowWindow(targetHwnd, 9); // SW_RESTORE
            SetForegroundWindow(targetHwnd);
            BringWindowToTop(targetHwnd);

            Thread.Sleep(800); // Wait for paint

            RECT finalRect;
            GetWindowRect(targetHwnd, out finalRect);
            int width = finalRect.Right - finalRect.Left;
            int height = finalRect.Bottom - finalRect.Top;

            if (width <= 0 || height <= 0) {
                summary = "Window has invalid dimensions: " + width + "x" + height;
                CloseDesktop(hDesk);
                return;
            }

            try {
                using (Bitmap bmp = new Bitmap(width, height)) {
                    using (Graphics g = Graphics.FromImage(bmp)) {
                        g.CopyFromScreen(finalRect.Left, finalRect.Top, 0, 0, new Size(width, height));
                    }
                    bmp.Save(outputPath, ImageFormat.Png);
                }
                summary = "Captured '" + targetTitle + "' (" + width + "x" + height + ") at [" + finalRect.Left + "," + finalRect.Top + "] -> " + outputPath;
            } catch (Exception ex) {
                summary = "Capture error: " + ex.Message;
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
$targetDir = [System.IO.Path]::GetDirectoryName($targetPath)
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing"
[HarnessWindowCapture]::FocusAndCapture($targetPath)
