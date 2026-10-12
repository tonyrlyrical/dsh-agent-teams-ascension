param(
    [string]$Action = "click",
    [int]$RelX = 700,
    [int]$RelY = 540,
    [string]$Text = "",
    [string]$OutputPath = "evidence/desktop-validation/screenshots/interact-result.png"
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;

public class ChromeInteract {
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
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBmp, uint nFlags);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }

    const uint WM_LBUTTONDOWN = 0x0201;
    const uint WM_LBUTTONUP   = 0x0202;
    const uint WM_MOUSEMOVE   = 0x0200;
    const uint WM_KEYDOWN     = 0x0100;
    const uint WM_KEYUP       = 0x0101;
    const uint WM_CHAR        = 0x0102;
    const uint VK_RETURN      = 0x0D;

    public static string Execute(string action, int relX, int relY, string text, string outputPath) {
        IntPtr targetTopHwnd = IntPtr.Zero;
        IntPtr targetRenderHwnd = IntPtr.Zero;
        string foundDesk = "";
        RECT topRect = new RECT();

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
                    int w = r.Right - r.Left;
                    int h = r.Bottom - r.Top;
                    if (w > 400 && h > 300) {
                        targetTopHwnd = hWnd;
                        topRect = r;
                        foundDesk = d;

                        EnumChildWindows(hWnd, (child, clp) => {
                            var cb = new StringBuilder(256);
                            GetClassName(child, cb, 256);
                            if (cb.ToString().Equals("Chrome_RenderWidgetHostHWND")) {
                                targetRenderHwnd = child;
                                return false;
                            }
                            return true;
                        }, IntPtr.Zero);

                        return false;
                    }
                }
                return true;
            }, IntPtr.Zero);

            if (targetTopHwnd != IntPtr.Zero) break;
            CloseDesktop(hDesk);
        }

        if (targetTopHwnd == IntPtr.Zero) return "DeepSeek Harness window not found";
        if (targetRenderHwnd == IntPtr.Zero) targetRenderHwnd = targetTopHwnd;

        const uint WM_ACTIVATE = 0x0006;
        const uint WM_SETFOCUS = 0x0007;

        ShowWindow(targetTopHwnd, 9);
        SetForegroundWindow(targetTopHwnd);
        SendMessage(targetTopHwnd, WM_ACTIVATE, (IntPtr)1, IntPtr.Zero);
        SendMessage(targetRenderHwnd, WM_SETFOCUS, targetTopHwnd, IntPtr.Zero);
        Thread.Sleep(200);

        IntPtr clickLParam = (IntPtr)((relY << 16) | (relX & 0xFFFF));

        if (action.Contains("click")) {
            // Move then click
            PostMessage(targetRenderHwnd, WM_MOUSEMOVE, IntPtr.Zero, clickLParam);
            Thread.Sleep(50);
            PostMessage(targetRenderHwnd, WM_LBUTTONDOWN, (IntPtr)1, clickLParam);
            Thread.Sleep(60);
            PostMessage(targetRenderHwnd, WM_LBUTTONUP, IntPtr.Zero, clickLParam);
            Thread.Sleep(300);
        }

        if (action.Contains("type") && !string.IsNullOrEmpty(text)) {
            foreach (char c in text) {
                short vk = VkKeyScan(c);
                byte vkCode = (byte)(vk & 0xFF);
                PostMessage(targetRenderHwnd, WM_KEYDOWN, (IntPtr)vkCode, IntPtr.Zero);
                PostMessage(targetRenderHwnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
                PostMessage(targetRenderHwnd, WM_KEYUP, (IntPtr)vkCode, IntPtr.Zero);
                Thread.Sleep(30);
            }
            Thread.Sleep(400);
        }

        if (action.Contains("enter")) {
            PostMessage(targetRenderHwnd, WM_KEYDOWN, (IntPtr)VK_RETURN, IntPtr.Zero);
            PostMessage(targetRenderHwnd, WM_CHAR, (IntPtr)VK_RETURN, IntPtr.Zero);
            PostMessage(targetRenderHwnd, WM_KEYUP, (IntPtr)VK_RETURN, IntPtr.Zero);
            Thread.Sleep(1000);
        }

        int width = topRect.Right - topRect.Left;
        int height = topRect.Bottom - topRect.Top;
        if (width > 0 && height > 0) {
            using (Bitmap bmp = new Bitmap(width, height)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    IntPtr hdc = g.GetHdc();
                    bool s = PrintWindow(targetTopHwnd, hdc, 2);
                    if (!s) PrintWindow(targetTopHwnd, hdc, 0);
                    g.ReleaseHdc(hdc);
                }
                bmp.Save(outputPath, ImageFormat.Png);
            }
        }

        return "OK: Action '" + action + "' sent to RenderHWND 0x" + targetRenderHwnd.ToString("X") + " at (" + relX + "," + relY + ") -> " + outputPath;
    }
}
'@ -ReferencedAssemblies "System.Drawing"

$res = [ChromeInteract]::Execute($Action, $RelX, $RelY, $Text, $OutputPath)
Write-Output $res
