param(
    [string]$OutputPath = "evidence/desktop-validation/screenshots/harness-plugins-scrolled.png"
)

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;

public class PluginsScroller {
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

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    private const uint MOUSEEVENTF_WHEEL = 0x0800;

    public static string ScrollAndCapture(string outputPath) {
        string summary = "";
        Thread t = new Thread(() => {
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk == IntPtr.Zero) return;
            SetThreadDesktop(hDesk);

            IntPtr targetHwnd = IntPtr.Zero;
            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    if (sb.ToString().Contains("DeepSeek Harness")) {
                        targetHwnd = hWnd;
                        return false;
                    }
                }
                return true;
            }, IntPtr.Zero);

            if (targetHwnd == IntPtr.Zero) return;

            RECT r;
            GetWindowRect(targetHwnd, out r);
            int centerX = r.Left + 600;
            int centerY = r.Top + 500;

            SetCursorPos(centerX, centerY);
            Thread.Sleep(100);

            // Scroll down: negative wheel delta
            for (int i = 0; i < 5; i++) {
                mouse_event(MOUSEEVENTF_WHEEL, (uint)centerX, (uint)centerY, unchecked((uint)-120), 0);
                Thread.Sleep(50);
            }

            Thread.Sleep(1000);

            int width = r.Right - r.Left;
            int height = r.Bottom - r.Top;

            using (Bitmap bmp = new Bitmap(width, height)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(width, height));
                }
                bmp.Save(outputPath, ImageFormat.Png);
            }
            summary = "Scrolled and captured to " + outputPath;
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
Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing"
[PluginsScroller]::ScrollAndCapture($targetPath)
