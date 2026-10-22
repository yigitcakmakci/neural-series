// Windows Hello check for NeuralWeb's password manager, owned by the browser window so the dialog opens on top of it.
// Usage: nwhello.exe <window handle> <message>
// Exit code: 0 verified, 1 cancelled or failed, 2 Windows Hello not set up on this computer, 3 error.
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Foundation;
using Windows.Security.Credentials.UI;

[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
interface IUserConsentVerifierInterop {
  [PreserveSig]
  int RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, [In] ref Guid riid, out IntPtr asyncOperation);
}

static class NwHello {
  // Waits by polling: the .NET helpers for awaiting WinRT calls need SDK metadata this computer does not have.
  static T Wait<T>(IAsyncOperation<T> op) {
    while (op.Status == AsyncStatus.Started) System.Threading.Thread.Sleep(30);
    if (op.Status != AsyncStatus.Completed) throw new Exception("istek " + op.Status);
    return op.GetResults();
  }
  static int Main(string[] args) {
    try {
      if (args.Length != 2) return 3;
      var availability = Wait(UserConsentVerifier.CheckAvailabilityAsync());
      if (availability != UserConsentVerifierAvailability.Available) { Console.WriteLine(availability); return 2; }
      var hwnd = new IntPtr(long.Parse(args[0]));
      var interop = (IUserConsentVerifierInterop)WindowsRuntimeMarshal.GetActivationFactory(typeof(UserConsentVerifier));
      var iunknown = new Guid("00000000-0000-0000-C000-000000000046");
      IntPtr raw;
      int hr = interop.RequestVerificationForWindowAsync(hwnd, args[1], ref iunknown, out raw);
      if (hr != 0) { Console.WriteLine("hata 0x" + hr.ToString("X8")); return 3; }
      var op = (IAsyncOperation<UserConsentVerificationResult>)Marshal.GetObjectForIUnknown(raw);
      Marshal.Release(raw);
      var result = Wait(op);
      Console.WriteLine(result);
      return result == UserConsentVerificationResult.Verified ? 0 : 1;
    } catch (Exception e) {
      Console.WriteLine(e.GetType().Name + ": " + e.Message);
      return 3;
    }
  }
}
