param(
    [int]$RelX = 0,
    [int]$RelY = 0,
    [string]$Action = "capture", # "click", "capture", "type", "paste", "click_and_paste", "click_paste_enter", "enter"
    [string]$Text = "",
    [string]$OutputPath = "evidence/desktop-validation/screenshots/gui-action.png"
)

$source = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.Diagnostics;

public class DshGuiDriver {
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

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    public static string Execute(string action, int relX, int relY, string text, string outputPath) {
        string summary = "";
        Thread t = new Thread(() => {
            try {
                IntPtr hWs = GetProcessWindowStation();
                List<string> desktops = new List<string>();
                EnumDesktops(hWs, (name, lParam) => {
                    desktops.Add(name);
                    return true;
                }, IntPtr.Zero);

                IntPtr targetHwnd = IntPtr.Zero;
                string foundDesk = "";
                string targetTitle = "";
                RECT winRect = new RECT();
                IntPtr targetDeskHandle = IntPtr.Zero;

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
                            string tStr = sb.ToString();

                            RECT r;
                            GetWindowRect(hWnd, out r);
                            int w = r.Right - r.Left;
                            int h = r.Bottom - r.Top;

                            bool isDsh = false;
                            try {
                                var p = Process.GetProcessById((int)pid);
                                if (p.ProcessName.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0) isDsh = true;
                            } catch {}

                            if ((tStr.IndexOf("DeepSeek", StringComparison.OrdinalIgnoreCase) >= 0 || isDsh) && w > 400 && h > 300) {
                                targetHwnd = hWnd;
                                foundDesk = dName;
                                targetTitle = string.IsNullOrEmpty(tStr) ? ("DeepSeek PID " + pid) : tStr;
                                winRect = r;
                                targetDeskHandle = hDesk;
                                return false;
                            }
                        }
                        return true;
                    }, IntPtr.Zero);

                    if (targetHwnd != IntPtr.Zero) break;
                    CloseDesktop(hDesk);
                }

                if (targetHwnd == IntPtr.Zero) {
                    summary = "DeepSeek Harness window not found on any desktop";
                    return;
                }

                ShowWindow(targetHwnd, 9); // SW_RESTORE
                SetForegroundWindow(targetHwnd);
                BringWindowToTop(targetHwnd);
                Thread.Sleep(300);

                GetWindowRect(targetHwnd, out winRect);

                if (action.Contains("click")) {
                    int absX = winRect.Left + relX;
                    int absY = winRect.Top + relY;
                    SetCursorPos(absX, absY);
                    Thread.Sleep(100);
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    Thread.Sleep(60);
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    Thread.Sleep(300);
                }

                if (action == "type") {
                    if (!string.IsNullOrEmpty(text)) {
                        SendKeys.SendWait(text);
                        Thread.Sleep(300);
                    }
                }

                if (action.Contains("paste")) {
                    if (!string.IsNullOrEmpty(text)) {
                        Clipboard.SetText(text);
                        Thread.Sleep(150);
                        keybd_event(0x11, 0, 0, 0); // CTRL down
                        keybd_event(0x56, 0, 0, 0); // V down
                        Thread.Sleep(60);
                        keybd_event(0x56, 0, KEYEVENTF_KEYUP, 0); // V up
                        keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0); // CTRL up
                        Thread.Sleep(400);
                    }
                }

                if (action.Contains("enter")) {
                    Thread.Sleep(200);
                    keybd_event(0x0D, 0, 0, 0); // ENTER down
                    Thread.Sleep(60);
                    keybd_event(0x0D, 0, KEYEVENTF_KEYUP, 0); // ENTER up
                    Thread.Sleep(800);
                }

                int width = winRect.Right - winRect.Left;
                int height = winRect.Bottom - winRect.Top;

                if (width > 0 && height > 0) {
                    using (Bitmap bmp = new Bitmap(width, height)) {
                        using (Graphics g = Graphics.FromImage(bmp)) {
                            IntPtr hdc = g.GetHdc();
                            bool success = PrintWindow(targetHwnd, hdc, 2);
                            if (!success) success = PrintWindow(targetHwnd, hdc, 0);
                            g.ReleaseHdc(hdc);
                        }
                        bmp.Save(outputPath, ImageFormat.Png);
                    }
                    summary = "Action '" + action + "' performed on '" + targetTitle + "' (" + width + "x" + height + ") on desktop '" + foundDesk + "' -> " + outputPath;
                }

                if (targetDeskHandle != IntPtr.Zero) CloseDesktop(targetDeskHandle);
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

Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing", "System.Windows.Forms"
$res = [DshGuiDriver]::Execute($Action, $RelX, $RelY, $Text, $targetPath)
Write-Output $res
