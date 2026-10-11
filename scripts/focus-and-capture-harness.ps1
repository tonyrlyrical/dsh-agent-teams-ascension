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
                    var sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    string title = sb.ToString();
                    if (title.Contains("DeepSeek Harness")) {
                        targetHwnd = hWnd;
                        targetTitle = title;
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

            RECT r;
            GetWindowRect(targetHwnd, out r);
            int width = r.Right - r.Left;
            int height = r.Bottom - r.Top;

            if (width <= 0 || height <= 0) {
                summary = "Window has invalid dimensions: " + width + "x" + height;
                CloseDesktop(hDesk);
                return;
            }

            try {
                using (Bitmap bmp = new Bitmap(width, height)) {
                    using (Graphics g = Graphics.FromImage(bmp)) {
                        g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(width, height));
                    }
                    bmp.Save(outputPath, ImageFormat.Png);
                }
                summary = "Captured '" + targetTitle + "' (" + width + "x" + height + ") at [" + r.Left + "," + r.Top + "] -> " + outputPath;
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
$dir = [System.IO.Path]::GetDirectoryName($targetPath)
if (-not [System.IO.Directory]::Exists($dir)) {
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
}
Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing"
[HarnessWindowCapture]::FocusAndCapture($targetPath)
