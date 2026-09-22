using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace HotelCityParkLauncher
{
    class Program
    {
        private static Process serverProcess = null;
        private static string baseDir = "";
        private static string nodePath = "";

        static void Main(string[] args)
        {
            Console.Title = "Hotel City Park CRM - Server";
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);

            // Hook exit events so server is cleanly terminated on window close or Ctrl+C
            AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
            Console.CancelKeyPress += OnCancelKeyPress;

            PrintHeader();

            // 1. Check if server is already running
            if (IsPortInUse(3000))
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("\n [!] Port 3000 is already active! Server is already running.");
                Console.ResetColor();
                Console.WriteLine(" Opening Hospitality Screen in default browser...");
                OpenBrowser("http://localhost:3000/hospitality");
                Console.WriteLine("\n Press any key to exit this launcher window (server remains active)...");
                Console.ReadKey(true);
                return;
            }

            // 2. Find Node.js executable
            nodePath = FindNodeExecutable();
            if (string.IsNullOrEmpty(nodePath))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("\n [ERROR] Node.js executable not found!");
                Console.ResetColor();
                Console.WriteLine(" Please ensure 'runtime\\node.exe' is present or Node.js is installed on this PC.");
                Console.WriteLine("\n Press any key to exit...");
                Console.ReadKey(true);
                return;
            }

            // 3. Start Server
            StartServer();

            // 4. Wait for server to become responsive
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.Write(" Starting server and initializing AppData database");
            bool isReady = false;
            for (int i = 0; i < 25; i++)
            {
                Thread.Sleep(500);
                Console.Write(".");
                if (IsPortInUse(3000))
                {
                    isReady = true;
                    break;
                }
            }
            Console.WriteLine();
            Console.ResetColor();

            if (isReady)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine(" [✓] Hotel City Park CRM is ONLINE!");
                Console.ResetColor();
                Console.WriteLine(" Opening Hospitality Screen: http://localhost:3000/hospitality\n");
                OpenBrowser("http://localhost:3000/hospitality");
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine(" [!] Server is taking longer than usual to bind port 3000.");
                Console.WriteLine(" Opening browser anyway: http://localhost:3000/hospitality\n");
                OpenBrowser("http://localhost:3000/hospitality");
            }

            PrintMenu();

            // 5. Interactive loop
            while (true)
            {
                if (serverProcess == null || serverProcess.HasExited)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("\n [!] Server process has stopped.");
                    Console.ResetColor();
                    Console.WriteLine(" Press [R] to restart server or [Q] to quit.");
                }

                ConsoleKeyInfo key = Console.ReadKey(true);
                if (key.Key == ConsoleKey.Q || (key.Modifiers.HasFlag(ConsoleModifiers.Control) && key.Key == ConsoleKey.C))
                {
                    Console.WriteLine("\n Shutting down Hotel City Park CRM...");
                    StopServer();
                    Thread.Sleep(500);
                    break;
                }
                else if (key.Key == ConsoleKey.O)
                {
                    Console.WriteLine(" Opening http://localhost:3000/hospitality...");
                    OpenBrowser("http://localhost:3000/hospitality");
                }
                else if (key.Key == ConsoleKey.D)
                {
                    string appDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HotelCityPark");
                    if (!Directory.Exists(appDataDir)) Directory.CreateDirectory(appDataDir);
                    Console.WriteLine(" Opening AppData database folder: " + appDataDir);
                    Process.Start("explorer.exe", "\"" + appDataDir + "\"");
                }
                else if (key.Key == ConsoleKey.R)
                {
                    Console.WriteLine(" Restarting server...");
                    StopServer();
                    Thread.Sleep(1000);
                    StartServer();
                    Thread.Sleep(1500);
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine(" [✓] Server restarted!");
                    Console.ResetColor();
                    PrintMenu();
                }
            }
        }

        private static void PrintHeader()
        {
            string appDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HotelCityPark");
            Console.ForegroundColor = ConsoleColor.DarkMagenta;
            Console.WriteLine("==================================================================");
            Console.ForegroundColor = ConsoleColor.Magenta;
            Console.WriteLine("              HOTEL CITY PARK CRM - DESKTOP EDITION               ");
            Console.ForegroundColor = ConsoleColor.DarkMagenta;
            Console.WriteLine("==================================================================");
            Console.ResetColor();
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.WriteLine(" Database Location: %APPDATA%\\HotelCityPark\\hotel_city_park.db");
            Console.WriteLine(" Full Path: " + Path.Combine(appDataDir, "hotel_city_park.db"));
            Console.ResetColor();
        }

        private static void PrintMenu()
        {
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.WriteLine("------------------------------------------------------------------");
            Console.ResetColor();
            Console.WriteLine("  Shortcuts:");
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("   [O]  Re-open Hospitality Screen in Browser");
            Console.WriteLine("   [D]  Open AppData Database Folder in Explorer");
            Console.WriteLine("   [R]  Restart Server");
            Console.WriteLine("   [Q]  Quit & Stop Server");
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.WriteLine("------------------------------------------------------------------");
            Console.ResetColor();
        }

        private static string FindNodeExecutable()
        {
            // 1. Check bundled runtime/node.exe
            string bundled = Path.Combine(baseDir, "runtime", "node.exe");
            if (File.Exists(bundled)) return bundled;

            // 2. Check root node.exe
            string rootNode = Path.Combine(baseDir, "node.exe");
            if (File.Exists(rootNode)) return rootNode;

            // 3. Check system PATH
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrEmpty(pathEnv))
            {
                foreach (string p in pathEnv.Split(Path.PathSeparator))
                {
                    try
                    {
                        string candidate = Path.Combine(p.Trim(), "node.exe");
                        if (File.Exists(candidate)) return candidate;
                    }
                    catch { }
                }
            }
            return null;
        }

        private static bool IsPortInUse(int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(400);
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void StartServer()
        {
            try
            {
                string serverScript = Path.Combine(baseDir, "server.js");
                if (!File.Exists(serverScript))
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine(" [ERROR] server.js not found in: " + baseDir);
                    Console.ResetColor();
                    return;
                }

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = baseDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false
                };
                psi.EnvironmentVariables["USE_APPDATA"] = "1";

                serverProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine(" [ERROR] Failed to start server: " + ex.Message);
                Console.ResetColor();
            }
        }

        private static void StopServer()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    serverProcess.WaitForExit(2000);
                    serverProcess = null;
                }
            }
            catch { }
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine(" Could not open browser automatically: " + ex.Message);
            }
        }

        private static void OnProcessExit(object sender, EventArgs e)
        {
            StopServer();
        }

        private static void OnCancelKeyPress(object sender, ConsoleCancelEventArgs e)
        {
            StopServer();
        }
    }
}
