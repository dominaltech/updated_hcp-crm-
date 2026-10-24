using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace HotelCityParkAdmin
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string targetPath = "hospitality";
            if (args != null && args.Length > 0)
            {
                string a = args[0].ToLower().TrimStart('-', '/');
                if (a == "crm" || a == "hospitality" || a == "frontdesk") targetPath = "hospitality";
                else if (a == "restaurant" || a == "pos") targetPath = "restaurant";
                else if (a == "bar") targetPath = "bar";
                else if (a == "store" || a == "storeman") targetPath = "storeman";
                else if (a == "store-admin") targetPath = "store-admin";
                else if (a == "manage" || a == "rooms") targetPath = "manage";
                else if (a == "apk" || a == "mobile" || a == "mobile-admin" || a == "expo") targetPath = "admin";
                else if (args[0].StartsWith("http://") || args[0].StartsWith("https://")) targetPath = args[0];
            }

            // Fast Path: Check if CRM on localhost:3000 is active right now
            bool crmHealthy = CheckHealth("http://localhost:3000/api/health", 500);

            if (crmHealthy)
            {
                string finalUrl;
                if (targetPath.StartsWith("http"))
                {
                    finalUrl = targetPath;
                }
                else if (targetPath == "admin")
                {
                    finalUrl = "http://localhost:8081/";
                }
                else
                {
                    finalUrl = "http://localhost:3000/" + targetPath.TrimStart('/') + "?admin=1";
                }

                LaunchBrowserApp(finalUrl);
                return;
            }

            // Localhost not immediately reachable - run launcher splash with auto-start
            Application.Run(new LauncherSplash(targetPath));
        }

        public static bool CheckHealth(string url, int timeoutMs)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    int code = (int)res.StatusCode;
                    return code >= 200 && code < 400;
                }
            }
            catch
            {
                return false;
            }
        }

        public static void LaunchBrowserApp(string targetUrl)
        {
            string[] preferredBrowsers = new string[]
            {
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe")
            };

            string foundBrowser = null;
            try
            {
                if (Process.GetProcessesByName("chrome").Length > 0 && File.Exists(preferredBrowsers[0]))
                {
                    foundBrowser = preferredBrowsers[0];
                }
                else if (Process.GetProcessesByName("msedge").Length > 0 && File.Exists(preferredBrowsers[2]))
                {
                    foundBrowser = preferredBrowsers[2];
                }
            }
            catch { }

            if (string.IsNullOrEmpty(foundBrowser))
            {
                foreach (string p in preferredBrowsers)
                {
                    if (File.Exists(p))
                    {
                        foundBrowser = p;
                        break;
                    }
                }
            }

            try
            {
                if (!string.IsNullOrEmpty(foundBrowser))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = foundBrowser;
                    psi.Arguments = string.Format("--app=\"{0}\" --window-size=1440,900", targetUrl);
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    return;
                }
            }
            catch { }

            try
            {
                ProcessStartInfo fallback = new ProcessStartInfo(targetUrl);
                fallback.UseShellExecute = true;
                Process.Start(fallback);
            }
            catch { }
        }
    }

    public class LauncherSplash : Form
    {
        private string targetPath;
        private Label lblTitle;
        private Label lblStatus;
        private ProgressBar progressBar;
        private Button btnRetry;
        private Button btnConfigure;
        private System.Windows.Forms.Timer pollTimer;
        private int checkCount = 0;
        private const int MaxAttempts = 24; // ~12 seconds
        private string resolvedBaseUrl = "";

        public LauncherSplash(string targetPath)
        {
            this.targetPath = targetPath;

            this.Text = "Hotel City Park - Admin Portal";
            this.Size = new Size(500, 220);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = ColorTranslator.FromHtml("#0F172A");
            this.ForeColor = Color.White;
            this.ShowInTaskbar = true;

            try
            {
                string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"public\electron_icon.ico");
                if (File.Exists(iconPath)) this.Icon = new Icon(iconPath);
            }
            catch { }

            lblTitle = new Label
            {
                Text = "👑 Hotel City Park - Admin Portal",
                Font = new Font("Segoe UI", 12f, FontStyle.Bold),
                ForeColor = ColorTranslator.FromHtml("#F59E0B"),
                Location = new Point(24, 20),
                AutoSize = true
            };

            lblStatus = new Label
            {
                Text = "Connecting to Hotel City Park CRM services...",
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = ColorTranslator.FromHtml("#94A3B8"),
                Location = new Point(24, 58),
                Size = new Size(440, 36)
            };

            progressBar = new ProgressBar
            {
                Location = new Point(24, 102),
                Size = new Size(436, 20),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 30
            };

            btnRetry = new Button
            {
                Text = "🔄 Retry Now",
                Location = new Point(240, 136),
                Size = new Size(110, 32),
                FlatStyle = FlatStyle.Flat,
                BackColor = ColorTranslator.FromHtml("#1E293B"),
                ForeColor = Color.White,
                Visible = false
            };
            btnRetry.Click += (s, e) => {
                checkCount = 0;
                btnRetry.Visible = false;
                btnConfigure.Visible = false;
                progressBar.Style = ProgressBarStyle.Marquee;
                lblStatus.Text = "Checking connection...";
                lblStatus.ForeColor = ColorTranslator.FromHtml("#94A3B8");
                pollTimer.Start();
                TryStartLocalServer();
            };

            btnConfigure = new Button
            {
                Text = "🌐 Change IP / Cloud",
                Location = new Point(356, 136),
                Size = new Size(130, 32),
                FlatStyle = FlatStyle.Flat,
                BackColor = ColorTranslator.FromHtml("#0284C7"),
                ForeColor = Color.White,
                Visible = false
            };
            btnConfigure.Click += (s, e) => ShowConfigDialog();

            this.Controls.Add(lblTitle);
            this.Controls.Add(lblStatus);
            this.Controls.Add(progressBar);
            this.Controls.Add(btnRetry);
            this.Controls.Add(btnConfigure);

            this.Load += LauncherSplash_Load;
        }

        private void LauncherSplash_Load(object sender, EventArgs e)
        {
            TryStartLocalServer();

            pollTimer = new System.Windows.Forms.Timer();
            pollTimer.Interval = 500;
            pollTimer.Tick += PollTimer_Tick;
            pollTimer.Start();
        }

        private void TryStartLocalServer()
        {
            ThreadPool.QueueUserWorkItem((_) =>
            {
                try
                {
                    string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                    string startScript = Path.Combine(baseDir, @"scripts\start_all.js");
                    string serverScript = Path.Combine(baseDir, "server.js");
                    string resStartScript = Path.Combine(baseDir, @"resources\app\scripts\start_all.js");
                    string resServerScript = Path.Combine(baseDir, @"resources\app\server.js");

                    string targetScript = null;
                    string workingDir = baseDir;

                    if (File.Exists(startScript)) { targetScript = startScript; workingDir = baseDir; }
                    else if (File.Exists(serverScript)) { targetScript = serverScript; workingDir = baseDir; }
                    else if (File.Exists(resStartScript)) { targetScript = resStartScript; workingDir = Path.Combine(baseDir, @"resources\app"); }
                    else if (File.Exists(resServerScript)) { targetScript = resServerScript; workingDir = Path.Combine(baseDir, @"resources\app"); }

                    if (!string.IsNullOrEmpty(targetScript))
                    {
                        string nodePath = FindNodeExe();
                        if (!string.IsNullOrEmpty(nodePath))
                        {
                            ProcessStartInfo psi = new ProcessStartInfo();
                            psi.FileName = nodePath;
                            if (targetScript.Contains("start_all.js"))
                            {
                                psi.Arguments = string.Format("\"{0}\" --local-only --no-open", targetScript);
                            }
                            else
                            {
                                psi.Arguments = string.Format("\"{0}\"", targetScript);
                            }
                            psi.WorkingDirectory = workingDir;
                            psi.CreateNoWindow = true;
                            psi.UseShellExecute = false;
                            psi.WindowStyle = ProcessWindowStyle.Hidden;
                            Process.Start(psi);
                        }
                    }
                }
                catch { }
            });
        }

        private string FindNodeExe()
        {
            string[] candidates = new string[]
            {
                "node.exe",
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe")
            };

            foreach (var c in candidates)
            {
                if (c == "node.exe") return c; // Let system resolve PATH
                if (File.Exists(c)) return c;
            }
            return "node";
        }

        private void PollTimer_Tick(object sender, EventArgs e)
        {
            checkCount++;

            // 1. Check localhost:3000
            bool crmUp = Program.CheckHealth("http://localhost:3000/api/health", 400);
            if (crmUp)
            {
                OnServerReady("http://localhost:3000");
                return;
            }

            // 3. If reached half timeout, also check LAN or remote_url.txt
            if (checkCount > 8)
            {
                string cloudUrl = ReadRemoteUrl();
                if (!string.IsNullOrEmpty(cloudUrl) && Program.CheckHealth(cloudUrl.TrimEnd('/') + "/api/health", 500))
                {
                    OnServerReady(cloudUrl);
                    return;
                }

                string lanIp = ReadLanIp();
                if (!string.IsNullOrEmpty(lanIp) && Program.CheckHealth("http://" + lanIp + "/api/health", 400))
                {
                    OnServerReady("http://" + lanIp);
                    return;
                }
            }

            if (checkCount >= MaxAttempts)
            {
                pollTimer.Stop();
                progressBar.Style = ProgressBarStyle.Blocks;
                progressBar.Value = 100;
                lblStatus.Text = "Could not connect to CRM server at http://localhost:3000.\nPlease ensure Node.js is running or configure remote IP.";
                lblStatus.ForeColor = ColorTranslator.FromHtml("#EF4444");
                btnRetry.Visible = true;
                btnConfigure.Visible = true;
            }
        }

        private void OnServerReady(string baseUrl)
        {
            pollTimer.Stop();
            resolvedBaseUrl = baseUrl;
            lblStatus.Text = "CRM Services Online! Opening Admin Panel...";
            lblStatus.ForeColor = ColorTranslator.FromHtml("#10B981");

            System.Windows.Forms.Timer delay = new System.Windows.Forms.Timer();
            delay.Interval = 250;
            delay.Tick += (s, ev) =>
            {
                delay.Stop();
                string finalUrl;
                if (targetPath.StartsWith("http"))
                {
                    finalUrl = targetPath;
                }
                else if (targetPath == "admin" || targetPath == "admin/")
                {
                    if (baseUrl.Contains("localhost") || baseUrl.Contains("127.0.0.1"))
                    {
                        finalUrl = "http://localhost:8081/";
                    }
                    else
                    {
                        finalUrl = baseUrl.TrimEnd('/') + "/admin/";
                    }
                }
                else
                {
                    finalUrl = baseUrl.TrimEnd('/') + "/" + targetPath.TrimStart('/') + "?admin=1";
                }
                Program.LaunchBrowserApp(finalUrl);
                this.Close();
            };
            delay.Start();
        }

        private string ReadRemoteUrl()
        {
            try
            {
                string rFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "remote_url.txt");
                if (File.Exists(rFile))
                {
                    string txt = File.ReadAllText(rFile).Trim();
                    if (!string.IsNullOrEmpty(txt) && txt.StartsWith("http") && !txt.Contains("localhost")) return txt;
                }
            }
            catch { }
            return null;
        }

        private string ReadLanIp()
        {
            try
            {
                string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HotelCityParkAdmin");
                string cfgFile = Path.Combine(appData, "config.ini");
                if (File.Exists(cfgFile))
                {
                    foreach (var l in File.ReadAllLines(cfgFile))
                    {
                        if (l.StartsWith("LocalHotelIp=")) return l.Substring("LocalHotelIp=".Length).Trim();
                    }
                }
            }
            catch { }
            return "10.160.83.195:3000";
        }

        private void ShowConfigDialog()
        {
            using (Form dlg = new Form())
            {
                dlg.Text = "Configure Connection";
                dlg.Size = new Size(420, 240);
                dlg.StartPosition = FormStartPosition.CenterParent;
                dlg.FormBorderStyle = FormBorderStyle.FixedDialog;
                dlg.MaximizeBox = false;
                dlg.MinimizeBox = false;
                dlg.BackColor = ColorTranslator.FromHtml("#0F172A");
                dlg.ForeColor = Color.White;

                Label lbl1 = new Label { Text = "Server IP / Host (e.g. localhost:3000 or 10.160.83.195:3000):", Location = new Point(20, 20), AutoSize = true };
                TextBox txtIp = new TextBox { Text = ReadLanIp(), Location = new Point(20, 45), Width = 360, BackColor = ColorTranslator.FromHtml("#1E293B"), ForeColor = Color.White };

                Button btnSave = new Button { Text = "Connect", Location = new Point(270, 140), Size = new Size(110, 34), FlatStyle = FlatStyle.Flat, BackColor = ColorTranslator.FromHtml("#0284C7"), ForeColor = Color.White };
                btnSave.Click += (s, e) =>
                {
                    string ip = txtIp.Text.Trim();
                    if (!string.IsNullOrEmpty(ip))
                    {
                        try
                        {
                            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HotelCityParkAdmin");
                            if (!Directory.Exists(appData)) Directory.CreateDirectory(appData);
                            File.WriteAllText(Path.Combine(appData, "config.ini"), "LocalHotelIp=" + ip);
                        }
                        catch { }
                        dlg.Close();
                        lblStatus.Text = "Testing connection to " + ip + "...";
                        pollTimer.Start();
                    }
                };

                dlg.Controls.Add(lbl1);
                dlg.Controls.Add(txtIp);
                dlg.Controls.Add(btnSave);
                dlg.ShowDialog(this);
            }
        }
    }
}
