param(
    [int]$RelX = 750,
    [int]$RelY = 540,
    [string]$Text = "/agent-teams",
    [string]$OutputPath = "evidence/desktop-validation/screenshots/harness-gui-12-robust-typed.png",
    [bool]$PressEnter = $false
)

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;

public class Win32Input {
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
    public static extern uint SendInput(uint nInputs, [In] INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public static string ClickAndType(int relX, int relY, string text, bool pressEnter, string outputPath) {
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

            // Click to focus
            int absX = winRect.Left + relX;
            int absY = winRect.Top + relY;
            SetCursorPos(absX, absY);
            Thread.Sleep(100);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            Thread.Sleep(60);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            Thread.Sleep(300);

            // Type text via SendInput UNICODE
            if (!string.IsNullOrEmpty(text)) {
                foreach (char c in text) {
                    INPUT down = new INPUT();
                    down.type = INPUT_KEYBOARD;
                    down.ki.wVk = 0;
                    down.ki.wScan = (ushort)c;
                    down.ki.dwFlags = KEYEVENTF_UNICODE;

                    INPUT up = new INPUT();
                    up.type = INPUT_KEYBOARD;
                    up.ki.wVk = 0;
                    up.ki.wScan = (ushort)c;
                    up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

                    INPUT[] inputs = new INPUT[] { down, up };
                    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
                    Thread.Sleep(30);
                }
            }

            if (pressEnter) {
                Thread.Sleep(300);
                INPUT down = new INPUT();
                down.type = INPUT_KEYBOARD;
                down.ki.wVk = 0x0D; // VK_RETURN
                down.ki.wScan = 0;
                down.ki.dwFlags = 0;

                INPUT up = new INPUT();
                up.type = INPUT_KEYBOARD;
                up.ki.wVk = 0x0D;
                up.ki.wScan = 0;
                up.ki.dwFlags = KEYEVENTF_KEYUP;

                INPUT[] inputs = new INPUT[] { down, up };
                SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
                Thread.Sleep(800);
            }

            Thread.Sleep(500);

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
[Win32Input]::ClickAndType($RelX, $RelY, $Text, $PressEnter, $targetPath)
