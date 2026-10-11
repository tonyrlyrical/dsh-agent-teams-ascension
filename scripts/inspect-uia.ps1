Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

public class UIAInspector {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public static string InspectHarness() {
        string output = "";
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

            if (targetHwnd != IntPtr.Zero) {
                try {
                    AutomationElement root = AutomationElement.FromHandle(targetHwnd);
                    var sb = new StringBuilder();
                    sb.AppendLine("Root: " + root.Current.Name + " (" + root.Current.ControlType.ProgrammaticName + ")");
                    
                    var cond = new PropertyCondition(AutomationElement.IsEnabledProperty, true);
                    var elements = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
                    sb.AppendLine("Total UIA elements found: " + elements.Count);
                    int count = 0;
                    foreach (AutomationElement el in elements) {
                        string name = el.Current.Name;
                        string ct = el.Current.ControlType.ProgrammaticName;
                        string aid = el.Current.AutomationId;
                        if (!string.IsNullOrWhiteSpace(name) || !string.IsNullOrWhiteSpace(aid)) {
                            sb.AppendLine(" - [" + ct + "] Name: '" + name + "' | AutoId: '" + aid + "'");
                            count++;
                            if (count >= 50) break;
                        }
                    }
                    output = sb.ToString();
                } catch (Exception ex) {
                    output = "UIA error: " + ex.Message;
                }
            } else {
                output = "Harness window not found";
            }
            CloseDesktop(hDesk);
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return output;
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies "UIAutomationClient", "UIAutomationTypes"
[UIAInspector]::InspectHarness()
