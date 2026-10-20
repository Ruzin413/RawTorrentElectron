using TorServices.CLI;
using TorServices.Core;
using TorServices.Data;
using TorServices.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Hosting;
using System.Diagnostics;

// ── Writable app paths ─────────────────────────────────────────────────────
// The packaged backend lives in a read-only directory, so all writable state
// (CSV store, metadata cache, log) goes to DataDir instead of BaseDirectory.
public static class AppPaths
{
    public static readonly string DataDir = ResolveDataDir();
    public static readonly string DefaultDownloadDir = ResolveDefaultDownloadDir();

    private static string ResolveDataDir()
    {
        var dir = Environment.GetEnvironmentVariable("RAWTORRENT_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dir))
        {
            var localAppData = Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData,
                Environment.SpecialFolderOption.Create);
            if (string.IsNullOrEmpty(localAppData)) localAppData = Path.GetTempPath();
            dir = Path.Combine(localAppData, "RawTorrent");
        }
        try
        {
            dir = Path.GetFullPath(dir);
            Directory.CreateDirectory(dir);
        }
        catch { }
        return dir;
    }

    private static string ResolveDefaultDownloadDir()
    {
        // Desktop stays primary for backwards compatibility with existing Windows installs
        var baseDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolderOption.None);
        if (string.IsNullOrEmpty(baseDir) || !Directory.Exists(baseDir))
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile, Environment.SpecialFolderOption.None);
            baseDir = string.IsNullOrEmpty(home) ? DataDir : Path.Combine(home, "Downloads");
        }
        return Path.Combine(baseDir, "TorrentDownload");
    }

    /// <summary>Returns the default download dir when <paramref name="outputDir"/> is null/empty.</summary>
    public static string ResolveOutputDir(string? outputDir) =>
        string.IsNullOrWhiteSpace(outputDir) ? DefaultDownloadDir : outputDir;
}

// ── Simple file logger ─────────────────────────────────────────────────────
public static class AppLogger
{
    private static readonly string LogPath = Path.Combine(
        AppPaths.DataDir,
        "rawtorrent_errors.log");

    private static readonly bool _enabled = ReadEnabledFromSettings();

    private static bool ReadEnabledFromSettings()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
            if (!File.Exists(path)) return false;
            var json = File.ReadAllText(path);
            var match = System.Text.RegularExpressions.Regex.Match(
                json, @"""FileLogging""\s*:\s*\{\s*""Enabled""\s*:\s*(true|false)", 
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return match.Success && match.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static void LogError(string tag, Exception? ex, string? extra = null)
    {
        try
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{tag}]";
            if (extra != null) line += $" {extra}";
            if (ex != null)
            {
                line += $"\n  Type   : {ex.GetType().FullName}";
                line += $"\n  Message: {ex.Message}";
                line += $"\n  Stack  :\n{ex.StackTrace}";
                if (ex.InnerException != null)
                    line += $"\n  Inner  : {ex.InnerException}";
            }
            line += "\n" + new string('-', 80);
            if (_enabled) File.AppendAllText(LogPath, line + "\n");
            Console.WriteLine(line);
            Debug.WriteLine(line);
        }
        catch { }
    }

    public static void Log(string tag, string message)
    {
        try
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{tag}] {message}";
            if (_enabled) File.AppendAllText(LogPath, line + "\n");
            Console.WriteLine(line);
        }
        catch { }
    }
}
// ──────────────────────────────────────────────────────────────────────────

class Program
{
    private static WebApplication? _app;

    [System.Runtime.InteropServices.DllImport("libc", SetLastError = false)]
    private static extern int getppid();

    static async Task Main(string[] args)
    {
        // Global exception hooks
        AppDomain.CurrentDomain.UnhandledException += (s, ex) =>
        {
            var err = ex.ExceptionObject as Exception;
            AppLogger.LogError("FATAL ERROR", err, $"IsTerminating={ex.IsTerminating}");
        };

        TaskScheduler.UnobservedTaskException += (s, ex) =>
        {
            AppLogger.LogError("TASK ERROR", ex.Exception);
            ex.SetObserved();
        };

        if (args.Length == 0)
        {
            await RunServer(args);
        }
        else
        {
            await RunCli(args);
        }
    }

    static async Task RunServer(string[] args)
    {
        // Ensure enough thread pool threads for Kestrel + download tasks
        // Without this, PieceManager file I/O starves the thread pool and
        // the API stops responding during download initialization
        ThreadPool.SetMinThreads(200, 200);

        AppLogger.Log("STARTUP", "Starting RawTorrent Server...");
        AppLogger.Log("STARTUP", $"Data directory: {AppPaths.DataDir}");

        StartParentWatchdog();

        try
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Services.AddControllers();
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();
            builder.Services.AddSingleton<CsvDataStore>();
            builder.Services.AddSingleton<TorrentService>();

            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowAll", b =>
                {
                    b.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
                });
            });

            int startPort = 5000;
            var portEnv = Environment.GetEnvironmentVariable("RAWTORRENT_PORT");
            // Electron picks a free port and points the UI at it, so that exact port must be used
            bool fixedPort = int.TryParse(portEnv, out var envPort) && envPort > 0 && envPort <= 65535;
            if (fixedPort) startPort = envPort;
            string host = fixedPort ? "127.0.0.1" : "localhost";
            int lastPort = fixedPort ? startPort : Math.Min(startPort + 899, 65535);

            int port = startPort;
            bool started = false;
            while (!started && port <= lastPort)
            {
                try
                {
                    builder.WebHost.UseUrls($"http://{host}:{port}");
                    _app = builder.Build();
                    
                    _app.UseCors("AllowAll");
                    if (_app.Environment.IsDevelopment())
                    {
                        _app.UseSwagger();
                        _app.UseSwaggerUI();
                    }
                    _app.UseAuthorization();
                    _app.MapControllers();

                    // Logged only once Kestrel has actually bound the port
                    int boundPort = port;
                    _app.Lifetime.ApplicationStarted.Register(() =>
                        AppLogger.Log("SERVER", $"RawTorrent Engine running at http://{host}:{boundPort}"));
                    await _app.RunAsync();
                    started = true;
                }
                catch (System.IO.IOException)
                {
                    port++;
                    builder = WebApplication.CreateBuilder(args);
                    builder.Services.AddControllers();
                    builder.Services.AddEndpointsApiExplorer();
                    builder.Services.AddSwaggerGen();
                    builder.Services.AddSingleton<CsvDataStore>();
                    builder.Services.AddSingleton<TorrentService>();
                    builder.Services.AddCors(options => { options.AddPolicy("AllowAll", b => { b.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader(); }); });
                }
            }

            if (!started) throw new Exception("Could not find an available port for the server.");
        }
        catch (Exception ex)
        {
            AppLogger.LogError("STARTUP ERROR", ex);
            Environment.ExitCode = 1;
        }
    }

    // Exits when the spawning (Electron) process is gone so an orphaned backend
    // does not keep holding its ports.
    static void StartParentWatchdog()
    {
        var pidEnv = Environment.GetEnvironmentVariable("RAWTORRENT_PARENT_PID");
        if (!int.TryParse(pidEnv, out var parentPid) || parentPid <= 0) return;

        AppLogger.Log("STARTUP", $"Watching parent process {parentPid}");

        // On Unix a killed parent can linger as a zombie (still "running" to Process),
        // but our own parent pid changes as soon as we are re-parented.
        int initialPpid = OperatingSystem.IsWindows() ? 0 : getppid();

        Task.Run(async () =>
        {
            while (true)
            {
                bool parentGone;
                try
                {
                    using var parent = Process.GetProcessById(parentPid);
                    parentGone = parent.HasExited;
                }
                catch (ArgumentException) { parentGone = true; }
                catch { parentGone = false; } // e.g. access denied - assume still alive

                if (!parentGone && initialPpid > 0 && getppid() != initialPpid)
                    parentGone = true;

                if (parentGone)
                {
                    AppLogger.Log("SHUTDOWN", $"Parent process {parentPid} exited; shutting down.");
                    Environment.Exit(0);
                }

                await Task.Delay(2000);
            }
        });
    }

    static async Task RunCli(string[] args)
    {
        string? targetFile = null;
        string? outputDir = null;

        var command = CommandParser.Parse(args);
        if (command == null || string.IsNullOrEmpty(command.TargetFile))
        {
            PrintUsage();
            return;
        }

        if (command.Action != CommandAction.Download)
        {
            Console.WriteLine($"Unknown action: {args[0]}");
            PrintUsage();
            return;
        }
        
        targetFile = command.TargetFile;
        outputDir = command.OutputDirectory;

        try
        {
            var controller = new TorrentController();
            if (targetFile.StartsWith("magnet:?", StringComparison.OrdinalIgnoreCase))
            {
                await controller.StartMagnetDownload(targetFile, outputDir);
            }
            else
            {
                await controller.StartDownload(targetFile, outputDir);
            }
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine($"\n[X] CRITICAL ERROR: {ex.Message}");
            if (ex.InnerException != null) Console.WriteLine($"   Inner: {ex.InnerException.Message}");
            Console.WriteLine(ex.StackTrace);
            Console.ResetColor();
        }
    }

    static void PrintUsage()
    {
        Console.WriteLine("Usage:");
        Console.WriteLine("  Just run the application without arguments to start the web server!");
        Console.WriteLine("  OR explicitly use CLI commands:");
        Console.WriteLine("  download <file.torrent>");
        Console.WriteLine("  download \"magnet:?xt=urn:...\"");
        Console.WriteLine("\nOptions:");
        Console.WriteLine("  -o, --output <dir>    Specify output directory");
        Console.WriteLine("  -v, --verbose         Enable verbose logging");
    }
}
