// Windows DPAPI for NeuralWeb's Edge password import: base64 in on stdin, base64 out on stdout.
// Usage: nwdpapi.exe unprotect | protect   (data is bound to the current Windows user)
using System;
using System.Security.Cryptography;

static class NwDpapi {
  static int Main(string[] args) {
    try {
      if (args.Length != 1) return 3;
      byte[] input = Convert.FromBase64String(Console.In.ReadToEnd().Trim());
      byte[] output = args[0] == "protect"
        ? ProtectedData.Protect(input, null, DataProtectionScope.CurrentUser)
        : ProtectedData.Unprotect(input, null, DataProtectionScope.CurrentUser);
      Console.Out.Write(Convert.ToBase64String(output));
      return 0;
    } catch (Exception e) {
      Console.Error.WriteLine(e.GetType().Name);
      return 1;
    }
  }
}
