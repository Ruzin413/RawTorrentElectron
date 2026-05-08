using TorServices.CLI;
using TorServices.Core;
using TorServices.Data;
using TorServices.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Hosting;
using System.Diagnostics;

// ── Simple file logger ─────────────────────────────────────────────────────
public static class AppLogger
{
    private static readonly string LogPath = Path.Combine(
        AppContext.BaseDirectory,
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

            int port = 5000;
            bool started = false;
            while (!started && port < 5900)
            {
                try
                {
                    builder.WebHost.UseUrls($"http://localhost:{port}");
                    _app = builder.Build();
                    
                    _app.UseCors("AllowAll");
                    if (_app.Environment.IsDevelopment())
                    {
                        _app.UseSwagger();
                        _app.UseSwaggerUI();
                    }
                    _app.UseAuthorization();
                    _app.MapControllers();

                    AppLogger.Log("SERVER", $"RawTorrent Engine running at http://localhost:{port}");
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
        }
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
