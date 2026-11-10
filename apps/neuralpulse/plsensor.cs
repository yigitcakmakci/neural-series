// NeuralPulse PL-2 measuring helper (C# 5, .NET Framework 4.x).
//   plsensor.exe                    one JSON line per second on stdout; stdin commands: pause, resume, quit; ends when
//                                   stdin closes (the program that started it is gone)
//   plsensor.exe --once [--top N]   two measurements about half a second apart, one JSON object, exit; with --top only
//                                   the N busiest processes (CPU, then memory)
//   plsensor.exe --demo [--once]    the same format with invented, slowly varying data (screenshots and tests)
// Sources, all readable without administrator rights and independent of the Windows display language:
//   CPU total        GetSystemTimes (busy = kernel + user - idle)
//   CPU per core     NtQuerySystemInformation(SystemProcessorPerformanceInformation)
//   memory           GlobalMemoryStatusEx (physical) and GetPerformanceInfo (commit charge and limit)
//   disks            "PhysicalDisk" counters, one ReadCategory() per sample (English names work on every language)
//   network          NetworkInterface byte counters (interfaces that are up, not loopback or tunnel), as deltas
//   GPU              "GPU Engine" (hundreds of instances: one ReadCategory() every 2 s) and "GPU Adapter Memory";
//                    names and memory sizes of the adapters from DXGI
//   processes        NtQuerySystemInformation(SystemProcessInformation): CPU time, private working set, for every
//                    process with no handle to open; the image path with QueryFullProcessImageName (limited access),
//                    once per process, null when Windows refuses
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace NeuralPulse
{
    static class Native
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

        [StructLayout(LayoutKind.Sequential)]
        public class MEMORYSTATUSEX
        {
            public uint dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            public uint dwMemoryLoad;
            public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX m);

        [StructLayout(LayoutKind.Sequential)]
        public struct PERFORMANCE_INFORMATION
        {
            public uint cb;
            public UIntPtr CommitTotal, CommitLimit, CommitPeak, PhysicalTotal, PhysicalAvailable, SystemCache, KernelTotal, KernelPaged, KernelNonpaged, PageSize;
            public uint HandleCount, ProcessCount, ThreadCount;
        }
        [DllImport("psapi.dll", SetLastError = true)]
        public static extern bool GetPerformanceInfo(out PERFORMANCE_INFORMATION p, uint cb);

        [DllImport("ntdll.dll")]
        public static extern int NtQuerySystemInformation(int cls, IntPtr buffer, int length, out int returned);
        public const int SystemProcessInformation = 5;
        public const int SystemProcessorPerformanceInformation = 8;
        public const int STATUS_INFO_LENGTH_MISMATCH = unchecked((int)0xC0000004);

        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr handle);

        [DllImport("dxgi.dll")]
        public static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IDXGIFactory1 factory);
    }

    // DXGI, only for the adapters' names, memory sizes and LUIDs (which name the GPU counter instances).
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DXGI_ADAPTER_DESC1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision;
        public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public uint LuidLow;
        public int LuidHigh;
        public uint Flags;
    }
    [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIAdapter1
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent(); // IDXGIObject
        void EnumOutputs(); void GetDesc(); void CheckInterfaceSupport();                                 // IDXGIAdapter
        [PreserveSig] int GetDesc1(out DXGI_ADAPTER_DESC1 desc);
    }
    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIFactory1
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();   // IDXGIObject
        void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter(); // IDXGIFactory
        [PreserveSig] int EnumAdapters1(uint index, [MarshalAs(UnmanagedType.Interface)] out IDXGIAdapter1 adapter);
        [PreserveSig] bool IsCurrent();
    }

    // A small JSON writer: ASCII only (anything else as \uXXXX), numbers in the invariant culture.
    class Json
    {
        readonly StringBuilder sb = new StringBuilder(32768);
        public Json Raw(string s) { sb.Append(s); return this; }
        public Json Str(string s)
        {
            if (s == null) { sb.Append("null"); return this; }
            sb.Append('"');
            foreach (char c in s)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < 0x20 || c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else sb.Append(c);
            }
            sb.Append('"');
            return this;
        }
        public Json Num(double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) v = 0;
            sb.Append(Math.Round(v, 1).ToString("0.#", CultureInfo.InvariantCulture));
            return this;
        }
        public Json Int(long v) { sb.Append(v.ToString(CultureInfo.InvariantCulture)); return this; }
        public Json Key(string k) { sb.Append('"').Append(k).Append("\":"); return this; }
        public override string ToString() { return sb.ToString(); }
    }

    class Proc
    {
        public int Pid;
        public string Name;
        public double Cpu;
        public long Mem;
        public string Path;
    }
    class Disk { public string Name; public double Read, Write, Busy; }
    class Net { public string Name; public double Rx, Tx; }
    class Gpu { public double Util; public long Used; public long Total; public string Name; }

    class Sample
    {
        public long T;
        public double CpuTotal;
        public double[] Cores = new double[0];
        public long MemTotal, MemUsed, Commit, CommitLimit;
        public List<Disk> Disks = new List<Disk>();
        public List<Net> Nets = new List<Net>();
        public Gpu Gpu;
        public List<Proc> Procs = new List<Proc>();

        public string ToJson(int top)
        {
            List<Proc> list = Procs;
            if (top > 0)
            {
                list = new List<Proc>(Procs);
                list.Sort(delegate(Proc a, Proc b)
                {
                    int c = b.Cpu.CompareTo(a.Cpu);
                    return c != 0 ? c : b.Mem.CompareTo(a.Mem);
                });
                if (list.Count > top) list.RemoveRange(top, list.Count - top);
            }
            Json j = new Json();
            j.Raw("{").Key("t").Int(T);
            j.Raw(",").Key("cpu").Raw("{").Key("total").Num(CpuTotal).Raw(",").Key("cores").Raw("[");
            for (int i = 0; i < Cores.Length; i++) { if (i > 0) j.Raw(","); j.Num(Cores[i]); }
            j.Raw("]}");
            j.Raw(",").Key("mem").Raw("{").Key("total").Int(MemTotal).Raw(",").Key("used").Int(MemUsed)
                .Raw(",").Key("commit").Int(Commit).Raw(",").Key("commitLimit").Int(CommitLimit).Raw("}");
            j.Raw(",").Key("disks").Raw("[");
            for (int i = 0; i < Disks.Count; i++)
            {
                Disk d = Disks[i];
                if (i > 0) j.Raw(",");
                j.Raw("{").Key("name").Str(d.Name).Raw(",").Key("read").Int((long)d.Read).Raw(",").Key("write").Int((long)d.Write).Raw(",").Key("busy").Num(d.Busy).Raw("}");
            }
            j.Raw("]");
            j.Raw(",").Key("net").Raw("[");
            for (int i = 0; i < Nets.Count; i++)
            {
                Net n = Nets[i];
                if (i > 0) j.Raw(",");
                j.Raw("{").Key("name").Str(n.Name).Raw(",").Key("rx").Int((long)n.Rx).Raw(",").Key("tx").Int((long)n.Tx).Raw("}");
            }
            j.Raw("]");
            j.Raw(",").Key("gpu");
            if (Gpu == null) j.Raw("null");
            else
            {
                j.Raw("{").Key("util").Num(Gpu.Util).Raw(",").Key("used").Int(Gpu.Used).Raw(",").Key("total");
                if (Gpu.Total > 0) j.Int(Gpu.Total); else j.Raw("null");
                j.Raw(",").Key("name").Str(Gpu.Name).Raw("}");
            }
            j.Raw(",").Key("procs").Raw("[");
            for (int i = 0; i < list.Count; i++)
            {
                Proc p = list[i];
                if (i > 0) j.Raw(",");
                j.Raw("{").Key("pid").Int(p.Pid).Raw(",").Key("name").Str(p.Name).Raw(",").Key("cpu").Num(p.Cpu)
                    .Raw(",").Key("mem").Int(p.Mem).Raw(",").Key("path").Str(p.Path).Raw("}");
            }
            j.Raw("]}");
            return j.ToString();
        }
    }

    interface ISampler
    {
        void Baseline();
        Sample Measure();
    }

    // ---------------------------------------------------------------- the real machine
    class RealSampler : ISampler
    {
        // CPU
        long sIdle, sKernel, sUser;
        long[] coreBusy = new long[0], coreAll = new long[0];
        IntPtr coreBuf = IntPtr.Zero;
        int coreBufLen;

        // processes: the previous CPU time and the path, per process (a pid with another creation time is another process)
        class Known { public long Create; public long CpuTime; public string Path; public bool PathTried; public int Seen; }
        readonly Dictionary<int, Known> known = new Dictionary<int, Known>();
        IntPtr procBuf = IntPtr.Zero;
        int procBufLen = 1 << 20;
        int round;
        long lastSampleFileTime;
        readonly StringBuilder pathSb = new StringBuilder(1024);

        // disks
        PerformanceCounterCategory diskCat;
        Dictionary<string, CounterSample[]> diskPrev = new Dictionary<string, CounterSample[]>();
        bool disksOk = true;

        // network
        Dictionary<string, long[]> netPrev = new Dictionary<string, long[]>();
        long netPrevTicks;

        // GPU
        PerformanceCounterCategory gpuCat, gpuMemCat;
        Dictionary<string, CounterSample> gpuPrev = new Dictionary<string, CounterSample>();
        bool gpuOk = true;
        long gpuReadAt = -1;
        Gpu gpuLast;
        List<string[]> adapters; // { luid key, name, dedicated bytes }

        readonly Stopwatch clock = Stopwatch.StartNew();
        public bool Once; // one measurement: every source is read at both ends of the interval

        public void Baseline()
        {
            BaselineFast();
            BaselineCounters();
        }
        // CPU, cores, processes, network: a few milliseconds.
        public void BaselineFast()
        {
            long i, k, u;
            Native.GetSystemTimes(out i, out k, out u);
            sIdle = i; sKernel = k; sUser = u;
            ReadCores(true);
            ReadProcs(0, true);
            ReadNets(true);
            lastSampleFileTime = DateTime.UtcNow.ToFileTimeUtc();
        }
        // Disks and GPU: the first use of the performance counters loads their names (more than half a second).
        public void BaselineCounters()
        {
            ReadDisks(true);
            ReadGpu(true);
        }

        public Sample Measure()
        {
            Sample s = new Sample();
            s.T = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            long i, k, u;
            Native.GetSystemTimes(out i, out k, out u);
            long dIdle = i - sIdle, dAll = (k - sKernel) + (u - sUser);
            sIdle = i; sKernel = k; sUser = u;
            s.CpuTotal = dAll > 0 ? Clamp(100.0 * (dAll - dIdle) / dAll) : 0;
            s.Cores = ReadCores(false);
            ReadMemory(s);
            s.Procs = ReadProcs(dAll, false);
            s.Disks = ReadDisks(false);
            s.Nets = ReadNets(false);
            s.Gpu = ReadGpu(false);
            lastSampleFileTime = DateTime.UtcNow.ToFileTimeUtc();
            return s;
        }

        static double Clamp(double v) { return v < 0 ? 0 : v > 100 ? 100 : v; }

        // SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION: IdleTime, KernelTime (idle included), UserTime, ... 48 bytes each.
        double[] ReadCores(bool baseline)
        {
            try
            {
                if (coreBuf == IntPtr.Zero) { coreBufLen = 48 * Math.Max(1, Environment.ProcessorCount); coreBuf = Marshal.AllocHGlobal(coreBufLen); }
                int got;
                int st = Native.NtQuerySystemInformation(Native.SystemProcessorPerformanceInformation, coreBuf, coreBufLen, out got);
                if (st == Native.STATUS_INFO_LENGTH_MISMATCH && got > coreBufLen)
                {
                    Marshal.FreeHGlobal(coreBuf);
                    coreBufLen = got;
                    coreBuf = Marshal.AllocHGlobal(coreBufLen);
                    st = Native.NtQuerySystemInformation(Native.SystemProcessorPerformanceInformation, coreBuf, coreBufLen, out got);
                }
                if (st != 0) return new double[0];
                int n = got / 48;
                double[] res = new double[n];
                if (coreBusy.Length != n) { coreBusy = new long[n]; coreAll = new long[n]; baseline = true; }
                for (int c = 0; c < n; c++)
                {
                    long idle = Marshal.ReadInt64(coreBuf, c * 48);
                    long kernel = Marshal.ReadInt64(coreBuf, c * 48 + 8);
                    long user = Marshal.ReadInt64(coreBuf, c * 48 + 16);
                    long all = kernel + user, busy = all - idle;
                    long dAll = all - coreAll[c], dBusy = busy - coreBusy[c];
                    res[c] = baseline || dAll <= 0 ? 0 : Clamp(100.0 * dBusy / dAll);
                    coreAll[c] = all; coreBusy[c] = busy;
                }
                return res;
            }
            catch (Exception) { return new double[0]; }
        }

        static void ReadMemory(Sample s)
        {
            Native.MEMORYSTATUSEX m = new Native.MEMORYSTATUSEX();
            if (Native.GlobalMemoryStatusEx(m))
            {
                s.MemTotal = (long)m.ullTotalPhys;
                s.MemUsed = (long)(m.ullTotalPhys - m.ullAvailPhys);
            }
            Native.PERFORMANCE_INFORMATION p;
            if (Native.GetPerformanceInfo(out p, (uint)Marshal.SizeOf(typeof(Native.PERFORMANCE_INFORMATION))))
            {
                long page = (long)p.PageSize.ToUInt64();
                s.Commit = (long)p.CommitTotal.ToUInt64() * page;
                s.CommitLimit = (long)p.CommitLimit.ToUInt64() * page;
            }
        }

        // SYSTEM_PROCESS_INFORMATION (x64): NextEntryOffset @0, WorkingSetPrivateSize @0x08, CreateTime @0x20,
        // UserTime @0x28, KernelTime @0x30, ImageName (UNICODE_STRING: Length @0x38, Buffer @0x40),
        // UniqueProcessId @0x50, PrivatePageCount @0xC8.
        List<Proc> ReadProcs(long dAll, bool baseline)
        {
            List<Proc> list = new List<Proc>(512);
            round++;
            try
            {
                if (procBuf == IntPtr.Zero) procBuf = Marshal.AllocHGlobal(procBufLen);
                int got, st;
                for (int tries = 0; ; tries++)
                {
                    st = Native.NtQuerySystemInformation(Native.SystemProcessInformation, procBuf, procBufLen, out got);
                    if (st != Native.STATUS_INFO_LENGTH_MISMATCH || tries > 4) break;
                    Marshal.FreeHGlobal(procBuf);
                    procBufLen = Math.Max(procBufLen * 2, got + (256 << 10));
                    procBuf = Marshal.AllocHGlobal(procBufLen);
                }
                if (st != 0) return list;
                int off = 0;
                while (true)
                {
                    IntPtr p = procBuf + off;
                    int next = Marshal.ReadInt32(p, 0);
                    int pid = (int)Marshal.ReadIntPtr(p, 0x50).ToInt64();
                    if (pid != 0) // the idle process is the idle time, not a process
                    {
                        long wsPrivate = Marshal.ReadInt64(p, 0x08);
                        long create = Marshal.ReadInt64(p, 0x20);
                        long cpu = Marshal.ReadInt64(p, 0x28) + Marshal.ReadInt64(p, 0x30);
                        int nameLen = (ushort)Marshal.ReadInt16(p, 0x38);
                        IntPtr nameBuf = Marshal.ReadIntPtr(p, 0x40);
                        long privateBytes = Marshal.ReadIntPtr(p, 0xC8).ToInt64();
                        string name = nameLen > 0 && nameBuf != IntPtr.Zero ? Marshal.PtrToStringUni(nameBuf, nameLen / 2) : "System";
                        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - 4);

                        Known kn;
                        double pct = 0;
                        if (known.TryGetValue(pid, out kn) && kn.Create == create)
                        {
                            if (dAll > 0) pct = 100.0 * (cpu - kn.CpuTime) / dAll;
                        }
                        else
                        {
                            kn = new Known { Create = create };
                            known[pid] = kn;
                            // started since the last measurement: all of its time falls in this interval
                            if (!baseline && dAll > 0 && create >= lastSampleFileTime) pct = 100.0 * cpu / dAll;
                        }
                        kn.CpuTime = cpu;
                        kn.Seen = round;
                        if (!kn.PathTried) { kn.PathTried = true; kn.Path = ImagePath(pid); }
                        if (!baseline)
                        {
                            Proc pr = new Proc();
                            pr.Pid = pid;
                            pr.Name = name;
                            pr.Cpu = Clamp(pct);
                            pr.Mem = wsPrivate > 0 ? wsPrivate : privateBytes;
                            pr.Path = kn.Path;
                            list.Add(pr);
                        }
                    }
                    if (next == 0) break;
                    off += next;
                }
                // forget the processes that ended
                List<int> gone = null;
                foreach (KeyValuePair<int, Known> e in known)
                    if (e.Value.Seen != round) { if (gone == null) gone = new List<int>(); gone.Add(e.Key); }
                if (gone != null) foreach (int g in gone) known.Remove(g);
            }
            catch (Exception) { /* an empty list this time */ }
            return list;
        }

        string ImagePath(int pid)
        {
            if (pid == 4) return null;
            IntPtr h = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                pathSb.Length = 0;
                pathSb.EnsureCapacity(1024);
                int size = pathSb.Capacity;
                if (!Native.QueryFullProcessImageName(h, 0, pathSb, ref size)) return null;
                string s = pathSb.ToString(0, size);
                return s.Length > 2 && s[1] == ':' ? s : null; // only ordinary drive paths
            }
            finally { Native.CloseHandle(h); }
        }

        List<Disk> ReadDisks(bool baseline)
        {
            List<Disk> list = new List<Disk>();
            if (!disksOk) return list;
            try
            {
                if (diskCat == null) diskCat = new PerformanceCounterCategory("PhysicalDisk");
                InstanceDataCollectionCollection all = diskCat.ReadCategory();
                InstanceDataCollection rd = all["Disk Read Bytes/sec"], wr = all["Disk Write Bytes/sec"], idle = all["% Idle Time"];
                if (rd == null || wr == null || idle == null) { disksOk = false; return list; }
                Dictionary<string, CounterSample[]> now = new Dictionary<string, CounterSample[]>();
                List<string> names = new List<string>();
                foreach (string key in rd.Keys)
                {
                    if (key == "_total" || !wr.Contains(key) || !idle.Contains(key)) continue;
                    names.Add(key);
                }
                names.Sort(StringComparer.Ordinal);
                foreach (string key in names)
                {
                    CounterSample[] cur = new CounterSample[] { rd[key].Sample, wr[key].Sample, idle[key].Sample };
                    now[key] = cur;
                    CounterSample[] old;
                    if (baseline || !diskPrev.TryGetValue(key, out old)) continue;
                    Disk d = new Disk();
                    d.Name = rd[key].InstanceName.ToUpperInvariant();
                    d.Read = Math.Max(0, CounterSample.Calculate(old[0], cur[0]));
                    d.Write = Math.Max(0, CounterSample.Calculate(old[1], cur[1]));
                    d.Busy = Clamp(100.0 - CounterSample.Calculate(old[2], cur[2]));
                    list.Add(d);
                }
                diskPrev = now;
            }
            catch (Exception) { disksOk = false; }
            return list;
        }

        List<Net> ReadNets(bool baseline)
        {
            List<Net> list = new List<Net>();
            try
            {
                long ticks = clock.ElapsedTicks;
                double secs = netPrevTicks > 0 ? (double)(ticks - netPrevTicks) / Stopwatch.Frequency : 0;
                netPrevTicks = ticks;
                Dictionary<string, long[]> now = new Dictionary<string, long[]>();
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    NetworkInterfaceType type = ni.NetworkInterfaceType;
                    if (type == NetworkInterfaceType.Loopback || type == NetworkInterfaceType.Tunnel) continue;
                    IPInterfaceStatistics st;
                    try { st = ni.GetIPStatistics(); } catch (Exception) { continue; }
                    long[] cur = new long[] { st.BytesReceived, st.BytesSent };
                    now[ni.Id] = cur;
                    long[] old;
                    if (baseline || secs <= 0 || !netPrev.TryGetValue(ni.Id, out old)) continue;
                    Net n = new Net();
                    n.Name = ni.Name;
                    n.Rx = Math.Max(0, (cur[0] - old[0]) / secs);
                    n.Tx = Math.Max(0, (cur[1] - old[1]) / secs);
                    list.Add(n);
                }
                netPrev = now;
            }
            catch (Exception) { /* none this time */ }
            return list;
        }

        // The adapters (hardware ones only) once: "luid_0x<high>_0x<low>", name, dedicated memory.
        void ReadAdapters()
        {
            adapters = new List<string[]>();
            try
            {
                Guid iid = typeof(IDXGIFactory1).GUID;
                IDXGIFactory1 f;
                if (Native.CreateDXGIFactory1(ref iid, out f) != 0 || f == null) return;
                for (uint i = 0; i < 16; i++)
                {
                    IDXGIAdapter1 a;
                    if (f.EnumAdapters1(i, out a) != 0 || a == null) break;
                    DXGI_ADAPTER_DESC1 d;
                    if (a.GetDesc1(out d) == 0 && (d.Flags & 2) == 0) // not the software renderer
                    {
                        string luid = "luid_0x" + ((uint)d.LuidHigh).ToString("x8", CultureInfo.InvariantCulture) + "_0x" + d.LuidLow.ToString("x8", CultureInfo.InvariantCulture);
                        adapters.Add(new string[] { luid, (d.Description ?? "").Trim(), d.DedicatedVideoMemory.ToUInt64().ToString(CultureInfo.InvariantCulture) });
                    }
                    Marshal.ReleaseComObject(a);
                }
                Marshal.ReleaseComObject(f);
            }
            catch (Exception) { /* no names and sizes */ }
        }

        // Utilisation as Task Manager shows it: per adapter, each engine type summed over its instances (processes),
        // the busiest type. The card shows the adapter with the most dedicated memory; its utilisation is the busiest
        // of all hardware adapters, so work on an integrated GPU shows too.
        Gpu ReadGpu(bool baseline)
        {
            if (!gpuOk) return null;
            long ms = clock.ElapsedMilliseconds;
            if (!baseline && !Once && gpuReadAt >= 0 && ms - gpuReadAt < 1900 && gpuLast != null) return gpuLast;
            try
            {
                if (gpuCat == null)
                {
                    gpuCat = new PerformanceCounterCategory("GPU Engine");
                    gpuMemCat = new PerformanceCounterCategory("GPU Adapter Memory");
                    ReadAdapters();
                }
                InstanceDataCollection util = gpuCat.ReadCategory()["Utilization Percentage"];
                if (util == null) { gpuOk = false; return null; }
                gpuReadAt = ms;
                Dictionary<string, CounterSample> now = new Dictionary<string, CounterSample>(util.Count);
                Dictionary<string, double> byType = new Dictionary<string, double>();
                foreach (InstanceData d in util.Values)
                {
                    string inst = d.InstanceName.ToLowerInvariant();
                    CounterSample cur = d.Sample;
                    now[inst] = cur;
                    CounterSample old;
                    if (baseline || !gpuPrev.TryGetValue(inst, out old)) continue;
                    int l = inst.IndexOf("luid_", StringComparison.Ordinal), ph = inst.IndexOf("_phys_", StringComparison.Ordinal), et = inst.IndexOf("_engtype_", StringComparison.Ordinal);
                    if (l < 0 || ph < l || et < 0) continue;
                    string key = inst.Substring(l, ph - l) + "|" + inst.Substring(et + 9);
                    double v = CounterSample.Calculate(old, cur);
                    if (v <= 0 || double.IsNaN(v)) continue;
                    double sum;
                    byType.TryGetValue(key, out sum);
                    byType[key] = sum + v;
                }
                gpuPrev = now;

                // dedicated memory in use, per adapter
                Dictionary<string, long> used = new Dictionary<string, long>();
                InstanceDataCollection ded = gpuMemCat.ReadCategory()["Dedicated Usage"];
                if (ded != null)
                    foreach (InstanceData d in ded.Values)
                    {
                        string inst = d.InstanceName.ToLowerInvariant();
                        int ph = inst.IndexOf("_phys_", StringComparison.Ordinal);
                        string key = ph > 0 ? inst.Substring(0, ph) : inst;
                        long have;
                        used.TryGetValue(key, out have);
                        used[key] = have + d.Sample.RawValue;
                    }

                Gpu g = new Gpu();
                string main = null;
                long best = -1;
                foreach (string[] a in adapters)
                {
                    long size = long.Parse(a[2], CultureInfo.InvariantCulture);
                    if (size > best) { best = size; main = a[0]; g.Name = a[1]; g.Total = size; }
                }
                if (main == null) // DXGI said nothing: the adapter with the most memory in use, no name or size
                    foreach (KeyValuePair<string, long> e in used) if (e.Value > best) { best = e.Value; main = e.Key; }
                if (main == null && byType.Count == 0 && used.Count == 0 && util.Count == 0) { gpuOk = false; return null; }
                long u;
                if (main != null && used.TryGetValue(main, out u)) g.Used = u;
                HashSet<string> hardware = new HashSet<string>();
                foreach (string[] a in adapters) hardware.Add(a[0]);
                foreach (KeyValuePair<string, double> e in byType)
                {
                    string luid = e.Key.Substring(0, e.Key.IndexOf('|'));
                    if (hardware.Count > 0 && !hardware.Contains(luid)) continue;
                    if (e.Value > g.Util) g.Util = e.Value;
                }
                g.Util = Clamp(g.Util);
                gpuLast = baseline ? null : g; // a baseline has no utilisation yet
                return g;
            }
            catch (Exception) { gpuOk = false; return null; }
        }
    }

    // ---------------------------------------------------------------- invented data
    class DemoSampler : ISampler
    {
        int k;
        static readonly string[] Names = {
            "neuralcore", "synapsed", "holo-render", "datastream", "cipherd", "gridwatch", "vectorcache", "signalhub",
            "lumen-shell", "quantum-idx", "archivist", "relayd", "mesh-sync", "optic-feed", "chronod", "beacon",
            "sentinel", "kernel-bridge", "netrunner", "ghostwire", "daemon-x", "pulse-agent", "flux-audio", "pixel-forge",
            "atlas-maps", "echo-chat", "nova-player", "orbit-mail", "vault-keeper", "spark-notes", "zen-calendar", "prism-photo",
            "cobalt-dev", "ember-build", "tidal-backup", "aurora-paint", "nimbus-drive", "radar-scan", "cortex-ai", "harbor-net",
            "spectre-vpn", "matrix-db", "onyx-print", "lattice-ui", "comet-update", "fusion-svc", "helix-index", "raven-log",
        };
        static double Hash(int a)
        {
            uint x = (uint)a * 2654435761u;
            x ^= x >> 13; x *= 1274126177u; x ^= x >> 16;
            return (x & 0xFFFFFF) / (double)0x1000000;
        }
        static double Clamp(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

        public void Baseline() { }
        public void Skip(int n) { k += n; }

        public Sample Measure() { return At(k++, (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds); }

        public Sample At(int n, long t)
        {
            Sample s = new Sample();
            s.T = t;
            const int cores = 8;
            s.Cores = new double[cores];
            double sum = 0;
            for (int c = 0; c < cores; c++)
            {
                double v = 22 + 15 * Math.Sin(n * 0.21 + c * 0.9) + 9 * Math.Sin(n * 0.057 + c * 2.1) + 8 * (Hash(n * 31 + c) - 0.5);
                s.Cores[c] = Math.Round(Clamp(v, 1, 99), 1);
                sum += s.Cores[c];
            }
            s.CpuTotal = Math.Round(sum / cores, 1);
            const long GB = 1L << 30;
            s.MemTotal = 32 * GB;
            s.MemUsed = (long)(13.4 * GB + 1.1 * GB * Math.Sin(n * 0.05) + 0.2 * GB * Hash(n * 7));
            s.Commit = (long)(s.MemUsed * 1.32);
            s.CommitLimit = 37 * GB;
            Disk d0 = new Disk();
            d0.Name = "0 N:";
            d0.Busy = Math.Round(Clamp(6 + 5 * Math.Sin(n * 0.33) + (Hash(n * 13) > 0.85 ? 35 * Hash(n * 17) : 0), 0, 100), 1);
            d0.Read = Math.Round(d0.Busy * 1.6e6 * (0.6 + Hash(n * 19)));
            d0.Write = Math.Round(d0.Busy * 0.7e6 * (0.5 + Hash(n * 23)));
            Disk d1 = new Disk();
            d1.Name = "1 V: W:";
            d1.Busy = Math.Round(Clamp(1.5 + 1.5 * Math.Sin(n * 0.11 + 1), 0, 100), 1);
            d1.Read = Math.Round(d1.Busy * 0.4e6 * Hash(n * 29));
            d1.Write = Math.Round(d1.Busy * 0.2e6 * Hash(n * 37));
            s.Disks.Add(d0);
            s.Disks.Add(d1);
            Net a = new Net();
            a.Name = "Neural-Link";
            a.Rx = Math.Round(1.8e6 * (1.1 + Math.Sin(n * 0.17)) * (0.7 + 0.6 * Hash(n * 41)));
            a.Tx = Math.Round(2.2e5 * (1.1 + Math.Sin(n * 0.13 + 2)) * (0.7 + 0.6 * Hash(n * 43)));
            Net b = new Net();
            b.Name = "Holo-Mesh";
            b.Rx = Math.Round(4.0e4 * (1 + Hash(n * 47)));
            b.Tx = Math.Round(1.5e4 * (1 + Hash(n * 53)));
            s.Nets.Add(a);
            s.Nets.Add(b);
            s.Gpu = new Gpu();
            s.Gpu.Util = Math.Round(Clamp(28 + 18 * Math.Sin(n * 0.09) + 10 * (Hash(n * 59) - 0.5), 0, 100), 1);
            s.Gpu.Total = 8 * GB;
            s.Gpu.Used = (long)(3.1 * GB + 0.4 * GB * Math.Sin(n * 0.04));
            s.Gpu.Name = "Neural Systems VX-90";
            for (int i = 0; i < Names.Length; i++)
            {
                Proc p = new Proc();
                p.Pid = 1200 + i * 532 + (int)(Hash(i * 101 + 7) * 130) * 4; // rising, so never twice
                p.Name = Names[i];
                double weight = i < 6 ? 6 - i : 0.35 * Hash(i * 11);
                p.Cpu = Math.Round(Clamp(weight * (1.2 + Math.Sin(n * 0.15 + i)) + (Hash(n * 67 + i) > 0.93 ? 4 * Hash(n + i) : 0), 0, 100), 1);
                p.Mem = (long)((8 + 900 * Hash(i * 3 + 1) * Hash(i * 5 + 2)) * (1 << 20) * (1 + 0.04 * Math.Sin(n * 0.07 + i)));
                p.Path = i % 9 == 4 ? null : "C:\\Neural\\Demo\\" + Names[i] + ".exe";
                s.Procs.Add(p);
            }
            return s;
        }
    }

    static class Program
    {
        static volatile bool paused;
        static readonly AutoResetEvent wake = new AutoResetEvent(false);
        static StreamWriter output;

        static void Emit(string line)
        {
            try { output.Write(line); output.Write('\n'); output.Flush(); }
            catch (Exception) { Environment.Exit(0); } // nobody reads any more
        }

        static int Main(string[] args)
        {
            bool once = false, demo = false;
            int top = 0;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].ToLowerInvariant();
                if (a == "--once") once = true;
                else if (a == "--demo") demo = true;
                else if (a == "--top" && i + 1 < args.Length) int.TryParse(args[++i], NumberStyles.Integer, CultureInfo.InvariantCulture, out top);
            }
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            Thread.CurrentThread.CurrentCulture = CultureInfo.InvariantCulture;
            try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.BelowNormal; } catch (Exception) { /* keep normal */ }

            ISampler sampler;
            if (demo) sampler = new DemoSampler();
            else { RealSampler real = new RealSampler(); real.Once = once; sampler = real; }
            if (once)
            {
                if (!demo)
                {
                    // Half a second for CPU and processes; the counters, whose first read takes long, get at least
                    // 350 ms after theirs, so the whole run stays near a second.
                    RealSampler real = (RealSampler)sampler;
                    Stopwatch w = Stopwatch.StartNew();
                    real.BaselineFast();
                    long fast = w.ElapsedMilliseconds;
                    real.BaselineCounters();
                    long until = Math.Max(fast + 500, w.ElapsedMilliseconds + 350);
                    long rest = until - w.ElapsedMilliseconds;
                    if (rest > 0) Thread.Sleep((int)rest);
                }
                Emit(sampler.Measure().ToJson(top));
                return 0;
            }

            // stdin: commands, and its end means the program that started this helper is gone
            Thread reader = new Thread(delegate()
            {
                try
                {
                    TextReader input = new StreamReader(Console.OpenStandardInput(), Encoding.ASCII);
                    string line;
                    while ((line = input.ReadLine()) != null)
                    {
                        string c = line.Trim().ToLowerInvariant();
                        if (c == "pause") { paused = true; wake.Set(); }
                        else if (c == "resume") { paused = false; wake.Set(); }
                        else if (c == "quit") break;
                    }
                }
                catch (Exception) { /* closed */ }
                Environment.Exit(0);
            });
            reader.IsBackground = true;
            reader.Start();

            Stopwatch clock = Stopwatch.StartNew();
            if (demo)
            {
                // a minute of history at once, so the graphs are full from the first moment
                DemoSampler ds = (DemoSampler)sampler;
                long now = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
                for (int n = 0; n < 59; n++) Emit(ds.At(n, now - (59 - n) * 1000L).ToJson(0));
                ds.Skip(59);
            }
            sampler.Baseline();
            long next = clock.ElapsedMilliseconds + (demo ? 0 : 1000);
            while (true)
            {
                if (paused)
                {
                    while (paused) wake.WaitOne();
                    sampler.Baseline();
                    next = clock.ElapsedMilliseconds + (demo ? 0 : 1000);
                    continue;
                }
                long wait = next - clock.ElapsedMilliseconds;
                if (wait > 0) { wake.WaitOne((int)Math.Min(wait, 1000)); continue; }
                Emit(sampler.Measure().ToJson(top));
                next += 1000;
                long t = clock.ElapsedMilliseconds;
                if (next <= t) next = t + 1000;
            }
        }
    }
}
