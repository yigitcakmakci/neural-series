using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// NeuralTerm pseudo-console bridge. Usage: ntpty <cols> <rows> <cwd> <command line>
// Starts the shell inside a Windows pseudo console (ConPTY). The console's output (UTF-8 with VT sequences)
// goes to stdout unchanged. Stdin carries frames: 1 byte type, 4 bytes little-endian length, payload.
//   'D' = keyboard data for the shell, 'R' = resize (int16 cols, int16 rows).
// When stdin closes the shell is ended; when the shell ends this process exits with its exit code.
static class Program {
  [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, IntPtr sa, int size);
  [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(COORD size, SafeFileHandle input, SafeFileHandle output, uint flags, out IntPtr hpc);
  [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr hpc, COORD size);
  [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr hpc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr retSize);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);

  static readonly bool Debug = Environment.GetEnvironmentVariable("NTPTY_DEBUG") == "1";
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;

  static int Main(string[] args) {
    if (args.Length < 4) { Console.Error.WriteLine("usage: ntpty <cols> <rows> <cwd> <command line>"); return 2; }
    if (Debug) Console.Error.WriteLine("start; stdin redirected=" + Console.IsInputRedirected);
    var size = new COORD { X = short.Parse(args[0]), Y = short.Parse(args[1]) };
    string cwd = Directory.Exists(args[2]) ? args[2] : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    string command = string.Join(" ", args, 3, args.Length - 3);

    SafeFileHandle ptyIn, inWrite, outRead, ptyOut;
    if (!CreatePipe(out ptyIn, out inWrite, IntPtr.Zero, 0) || !CreatePipe(out outRead, out ptyOut, IntPtr.Zero, 0)) return Fail("pipes");
    IntPtr hpc;
    if (CreatePseudoConsole(size, ptyIn, ptyOut, 0, out hpc) != 0) return Fail("pseudo console");

    IntPtr listSize = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize);
    var si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
    // Our own stdin/stdout are pipes to NeuralTerm; without this the shell would inherit them instead of the pseudo console.
    si.StartupInfo.dwFlags = 0x00000100; // STARTF_USESTDHANDLES with no handles
    si.lpAttributeList = Marshal.AllocHGlobal(listSize);
    if (!InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, ref listSize)) return Fail("attribute list");
    if (!UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, hpc, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) return Fail("attribute");

    PROCESS_INFORMATION pi;
    if (!CreateProcessW(null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, cwd, ref si, out pi))
      return Fail("could not start: " + command);
    // The pseudo console keeps its own copies of these ends.
    ptyIn.Dispose();
    ptyOut.Dispose();

    Stream stdout = Console.OpenStandardOutput();
    // Read our stdin pipe with plain ReadFile calls; the console stream wrapper does not see data written by Node.
    IntPtr stdinHandle = GetStdHandle(-10);
    var fromShell = new FileStream(outRead, FileAccess.Read, 1);

    var outThread = new Thread(() => {
      var buf = new byte[32768];
      int n;
      try { while ((n = fromShell.Read(buf, 0, buf.Length)) > 0) { stdout.Write(buf, 0, n); stdout.Flush(); } } catch { }
    });
    outThread.IsBackground = true;
    outThread.Start();

    var inThread = new Thread(() => {
      var head = new byte[5];
      if (Debug) Console.Error.WriteLine("input thread running");
      try {
        while (ReadExact(stdinHandle, head, 5)) {
          int len = BitConverter.ToInt32(head, 1);
          var data = new byte[len];
          if (!ReadExact(stdinHandle, data, len)) break;
          if (Debug) Console.Error.WriteLine("frame " + (char)head[0] + " " + len);
          if (head[0] == (byte)'D') { WriteAll(inWrite.DangerousGetHandle(), data); if (Debug) Console.Error.WriteLine("written " + len); }
          else if (head[0] == (byte)'R' && len == 4) ResizePseudoConsole(hpc, new COORD { X = BitConverter.ToInt16(data, 0), Y = BitConverter.ToInt16(data, 2) });
        }
      } catch (Exception e) { if (Debug) Console.Error.WriteLine("input: " + e.Message); }
      if (Debug) Console.Error.WriteLine("input ended");
      TerminateProcess(pi.hProcess, 1); // the window closed this tab
    });
    inThread.IsBackground = true;
    inThread.Start();

    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    ClosePseudoConsole(hpc); // flushes the last output and ends the reader
    outThread.Join(3000);
    return (int)code;
  }

  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern unsafe bool ReadFile(IntPtr h, byte* buf, int count, out int read, IntPtr overlapped);

  [DllImport("kernel32.dll", SetLastError = true)] static extern unsafe bool WriteFile(IntPtr h, byte* buf, int count, out int written, IntPtr overlapped);

  static unsafe void WriteAll(IntPtr h, byte[] buf) {
    int done = 0;
    fixed (byte* p = buf) {
      while (done < buf.Length) {
        int n;
        if (!WriteFile(h, p + done, buf.Length - done, out n, IntPtr.Zero)) throw new IOException("write " + Marshal.GetLastWin32Error());
        done += n;
      }
    }
  }

  static unsafe bool ReadExact(IntPtr h, byte[] buf, int len) {
    int got = 0;
    fixed (byte* p = buf) {
      while (got < len) {
        int n;
        if (!ReadFile(h, p + got, len - got, out n, IntPtr.Zero) || n <= 0) return false;
        got += n;
      }
    }
    return true;
  }

  static int Fail(string what) {
    Console.Error.WriteLine("ntpty: " + what + " (" + Marshal.GetLastWin32Error() + ")");
    return 1;
  }
}
