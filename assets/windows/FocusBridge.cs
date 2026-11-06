using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace PasteBoardNative {
  public class FocusContext {
    public string window = "0";
    public string control = "0";
    public uint process;
    public bool editable;
    public bool caretLocated;
    public string elementKey = "";
    public double x, y, width, height;
  }
  public class PasteResult { public bool pasted; public string message; }
  public static class FocusBridge {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO {
      public uint cbSize, flags;
      public IntPtr active, focus, capture, menu, moveSize, caret;
      public RECT rect;
    }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref POINT point);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);

    // Capture coordinates and handles only. Never read the input field's text or selection text.
    public static FocusContext Capture(string ownWindow) {
      var result = new FocusContext();
      try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
      IntPtr foreground = GetForegroundWindow();
      if (foreground == IntPtr.Zero || foreground.ToInt64().ToString() == ownWindow) return result;
      result.window = foreground.ToInt64().ToString();
      uint thread = GetWindowThreadProcessId(foreground, out result.process);
      var info = new GUITHREADINFO { cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
      if (GetGUIThreadInfo(thread, ref info)) {
        result.control = info.focus.ToInt64().ToString();
        if (info.caret != IntPtr.Zero && info.rect.bottom > info.rect.top) {
          var point = new POINT { x = info.rect.left, y = info.rect.top };
          if (ClientToScreen(info.caret, ref point)) {
            result.x = point.x; result.y = point.y;
            result.width = Math.Max(1, info.rect.right - info.rect.left);
            result.height = info.rect.bottom - info.rect.top;
            result.editable = true; result.caretLocated = true;
          }
        }
      }
      try {
        var element = AutomationElement.FocusedElement;
        if (element == null || element.Current.ProcessId != result.process) return result;
        result.elementKey = string.Join("-", element.GetRuntimeId());
        object pattern;
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) result.editable = !((ValuePattern)pattern).Current.IsReadOnly;
        if (element.Current.ControlType == ControlType.Edit) result.editable = true;
        if (result.editable && !result.caretLocated && element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
          var textPattern = (TextPattern)pattern;
          var selection = textPattern.GetSelection();
          if (selection != null && selection.Length > 0) {
            var range = selection[0].Clone();
            range.MoveEndpointByRange(TextPatternRangeEndpoint.Start, range, TextPatternRangeEndpoint.End);
            bool atDocumentEnd = range.CompareEndpoints(TextPatternRangeEndpoint.End, textPattern.DocumentRange, TextPatternRangeEndpoint.End) == 0;
            var rects = range.GetBoundingRectangles();
            if (rects.Length == 0 || rects[0].Height <= 0) {
              range.ExpandToEnclosingUnit(TextUnit.Character);
              rects = range.GetBoundingRectangles();
            }
            if (rects.Length > 0 && rects[0].Height > 0) {
              result.x = rects[0].Left + (atDocumentEnd ? rects[0].Width : 0); result.y = rects[0].Top;
              result.width = 1; result.height = rects[0].Height; result.caretLocated = true;
              return result;
            }
          }
        }
        if (result.editable && !result.caretLocated) {
          var bounds = element.Current.BoundingRectangle;
          if (!bounds.IsEmpty && bounds.Height > 0) {
            result.x = bounds.Left + 8; result.y = bounds.Bottom - 2; result.width = 1; result.height = 2;
          }
        }
      } catch { /* Some applications do not expose UI Automation patterns. */ }
      return result;
    }

    // No SetForegroundWindow/SetFocus or AttachThreadInput: the popup must not steal focus.
    public static PasteResult Paste(string window, string control, uint process, string elementKey) {
      long handle;
      if (!long.TryParse(window, out handle) || handle == 0) return Failure("未找到原输入框，请先在输入框中按快捷键唤出剪贴板。");
      var target = new IntPtr(handle);
      string problem = ValidateTarget(target, control, process, elementKey);
      if (problem != null) return Failure(problem);
      // Wait for the user's shortcut modifiers to be released; never release their keys for them.
      for (int i = 0; i < 50; i++) {
        if (!Pressed(0x10) && !Pressed(0x11) && !Pressed(0x12) && !Pressed(0x5B) && !Pressed(0x5C)) break;
        Thread.Sleep(10);
      }
      if (Pressed(0x10) || Pressed(0x11) || Pressed(0x12) || Pressed(0x5B) || Pressed(0x5C)) return Failure("请松开快捷键后再点击词条。");
      problem = ValidateTarget(target, control, process, elementKey);
      if (problem != null) return Failure(problem);
      var keys = new INPUT[] { Key(0x11, false), Key(0x56, false), Key(0x56, true), Key(0x11, true) };
      uint sent = SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT)));
      if (sent != keys.Length) return Failure("目标程序拒绝自动粘贴（可能以管理员权限运行）。内容已复制，可手动粘贴。");
      return new PasteResult { pasted = true, message = "已发送粘贴到原输入框" };
    }
    static string ValidateTarget(IntPtr target, string control, uint process, string elementKey) {
      if (!IsWindow(target) || GetForegroundWindow() != target) return ("焦点已切换。内容已复制，请在目标输入框重新唤出后粘贴。");
      uint currentProcess;
      uint thread = GetWindowThreadProcessId(target, out currentProcess);
      if (currentProcess != process) return ("原窗口已经关闭，请重新唤出剪贴板。");
      var info = new GUITHREADINFO { cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
      bool hasGuiInfo = GetGUIThreadInfo(thread, ref info);
      if (!hasGuiInfo && string.IsNullOrEmpty(elementKey)) return "无法确认原输入框，内容已复制，请手动粘贴。";
      if (hasGuiInfo && info.focus.ToInt64().ToString() != control) return ("输入焦点已改变，请在目标输入框重新唤出剪贴板。");
      if (!string.IsNullOrEmpty(elementKey)) {
        try {
          var element = AutomationElement.FocusedElement;
          if (element == null || string.Join("-", element.GetRuntimeId()) != elementKey) return ("输入框已改变，请重新唤出剪贴板。");
        } catch { return ("无法确认原输入框，内容已复制，请手动粘贴。"); }
      }
      return null;
    }
    static bool Pressed(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    static INPUT Key(ushort key, bool up) { return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { vk = key, flags = up ? 2u : 0u } } }; }
    static PasteResult Failure(string message) { return new PasteResult { pasted = false, message = message }; }
  }
}
