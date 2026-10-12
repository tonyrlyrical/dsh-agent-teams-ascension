param(
    [int]$RelX = 1000,
    [int]$RelY = 580,
    [string]$Text = "/agent-teams write a simple hello-world function in TypeScript",
    [int]$SelectAll = 1,
    [int]$PressEnter = 1,
    [int]$WaitSec = 4,
    [string]$OutputPath = "evidence/desktop-validation/screenshots/harness-gui-14-prompt-submitted.png"
)

# Put text on clipboard
Set-Clipboard -Value $Text

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;

public class PasteSubmitHelper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

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
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    public static string Submit(int relX, int relY, bool selectAll, bool pressEnter, int waitSec, string outputPath) {
        string res = "";
        Thread t = new Thread(() => {
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            SetThreadDesktop(hDesk);

            IntPtr targetHwnd = IntPtr.Zero;
            RECT winRect = new RECT();
            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    string tStr = sb.ToString();
                    if (tStr.Contains("DeepSeek Harness")) {
                        RECT r;
                        GetWindowRect(hWnd, out r);
                        if (r.Right - r.Left > 400) {
                            targetHwnd = hWnd;
                            winRect = r;
                            return false;
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);

            if (targetHwnd == IntPtr.Zero) {
                res = "Harness not found";
                CloseDesktop(hDesk);
                return;
            }

            ShowWindow(targetHwnd, 9); // SW_RESTORE

            IntPtr fgHwnd = GetForegroundWindow();
            uint dummy;
            uint fgThread = GetWindowThreadProcessId(fgHwnd, out dummy);
            uint curThread = GetCurrentThreadId();
            AttachThreadInput(curThread, fgThread, true);
            SetForegroundWindow(targetHwnd);
            BringWindowToTop(targetHwnd);
            AttachThreadInput(curThread, fgThread, false);

            Thread.Sleep(300);
            GetWindowRect(targetHwnd, out winRect);

            int absX = winRect.Left + relX;
            int absY = winRect.Top + relY;
            SetCursorPos(absX, absY);
            Thread.Sleep(150);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            Thread.Sleep(60);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            Thread.Sleep(300);

            if (selectAll) {
                // Ctrl+A
                keybd_event(0x11, 0, 0, 0); // VK_CONTROL down
                Thread.Sleep(40);
                keybd_event(0x41, 0, 0, 0); // 'A' down
                Thread.Sleep(50);
                keybd_event(0x41, 0, KEYEVENTF_KEYUP, 0); // 'A' up
                Thread.Sleep(40);
                keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0); // VK_CONTROL up
                Thread.Sleep(200);
            }

            // Ctrl+V
            keybd_event(0x11, 0, 0, 0); // VK_CONTROL down
            Thread.Sleep(40);
            keybd_event(0x56, 0, 0, 0); // 'V' down
            Thread.Sleep(50);
            keybd_event(0x56, 0, KEYEVENTF_KEYUP, 0); // 'V' up
            Thread.Sleep(40);
            keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0); // VK_CONTROL up
            Thread.Sleep(400);

            if (pressEnter) {
                // Enter
                keybd_event(0x0D, 0, 0, 0); // VK_RETURN down
                Thread.Sleep(60);
                keybd_event(0x0D, 0, KEYEVENTF_KEYUP, 0); // VK_RETURN up
                Thread.Sleep(waitSec * 1000);
            }

            // Capture
            int width = winRect.Right - winRect.Left;
            int height = winRect.Bottom - winRect.Top;
            if (width > 0 && height > 0) {
                using (Bitmap bmp = new Bitmap(width, height)) {
                    using (Graphics g = Graphics.FromImage(bmp)) {
                        g.CopyFromScreen(winRect.Left, winRect.Top, 0, 0, new Size(width, height));
                    }
                    bmp.Save(outputPath, ImageFormat.Png);
                }
                res = "Captured " + width + "x" + height + " to " + outputPath;
            }

            CloseDesktop(hDesk);
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return res;
    }
}
"@

$targetPath = [System.IO.Path]::GetFullPath($OutputPath)
Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing"
[PasteSubmitHelper]::Submit($RelX, $RelY, [bool]($SelectAll -ne 0), [bool]($PressEnter -ne 0), $WaitSec, $targetPath)
