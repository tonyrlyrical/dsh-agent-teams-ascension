param(
    [string]$OutputPath = "evidence/desktop-validation/screenshots/harness-back-to-session.png"
)

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;

public class BackToSession {
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

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public static string GoBack(string outputPath) {
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

            // 1. Click < Plugins link at X: ~335, Y: ~92
            int clickX = r.Left + 335;
            int clickY = r.Top + 92;
            SetCursorPos(clickX, clickY);
            Thread.Sleep(100);
            mouse_event(MOUSEEVENTF_LEFTDOWN, (uint)clickX, (uint)clickY, 0, 0);
            Thread.Sleep(80);
            mouse_event(MOUSEEVENTF_LEFTUP, (uint)clickX, (uint)clickY, 0, 0);
            Thread.Sleep(600);

            // 2. Click FERRET 2.2 session item: X: ~80, Y: ~390
            clickX = r.Left + 80;
            clickY = r.Top + 390;
            SetCursorPos(clickX, clickY);
            Thread.Sleep(100);
            mouse_event(MOUSEEVENTF_LEFTDOWN, (uint)clickX, (uint)clickY, 0, 0);
            Thread.Sleep(80);
            mouse_event(MOUSEEVENTF_LEFTUP, (uint)clickX, (uint)clickY, 0, 0);
            Thread.Sleep(1000);

            int width = r.Right - r.Left;
            int height = r.Bottom - r.Top;

            using (Bitmap bmp = new Bitmap(width, height)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(width, height));
                }
                bmp.Save(outputPath, ImageFormat.Png);
            }
            summary = "Navigated back and captured to " + outputPath;
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
[BackToSession]::GoBack($targetPath)
