using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HotelCityParkAdmin
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // Enable IE11 emulation for embedded WebBrowser control
            SetWebBrowserFeatures();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainWindow(args));
        }

        static void SetWebBrowserFeatures()
        {
            try
            {
                string appName = Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName);
                using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_BROWSER_EMULATION"))
                {
                    if (key != null)
                    {
                        key.SetValue(appName, 11001, RegistryValueKind.DWord);
                    }
                }
            }
            catch { }
        }
    }

    public class MainWindow : Form
    {
        private Panel topBar;
        private Label lblLogo;
        private Label lblStatus;
        private Button btnAdmin;
        private Button btnCrm;
        private Button btnRestaurant;
        private Button btnBar;
        private Button btnStore;
        private Button btnRefresh;
        private Button btnSettings;
        private Button btnEdgeApp;
        private WebBrowser browser;

        private string currentBaseUrl = "";
        private string currentPath = "admin/";
        private string remoteCloudUrl = "https://delayed-eligible-gazette-related.trycloudflare.com";
        private string localHotelIp = "10.160.83.195:3000";
        private bool isCloudMode = true;

        public MainWindow(string[] args)
        {
            LoadConfig();

            this.Text = "👑 Hotel City Park - Admin & Owner Portal";
            this.Size = new Size(1360, 860);
            this.MinimumSize = new Size(1024, 700);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = ColorTranslator.FromHtml("#0A191C");
            this.ForeColor = Color.White;

            // Try to set application icon if available
            try
            {
                string[] possibleIcons = { "icon.ico", "app_icon.ico", "electron_icon.ico", @"build\icon.ico" };
                foreach (var ic in possibleIcons)
                {
                    if (File.Exists(ic))
                    {
                        this.Icon = new Icon(ic);
                        break;
                    }
                }
            }
            catch { }

            InitUI();
            DetectBestConnectionAndNavigate();
        }

        private void InitUI()
        {
            // Top Navigation Bar
            topBar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 56,
                BackColor = ColorTranslator.FromHtml("#0F2A2E"),
                Padding = new Padding(12, 8, 12, 8)
            };

            lblLogo = new Label
            {
                Text = "👑 HOTEL CITY PARK",
                Font = new Font("Segoe UI", 11.5f, FontStyle.Bold),
                ForeColor = ColorTranslator.FromHtml("#E2B25E"),
                AutoSize = true,
                Location = new Point(14, 16)
            };

            // Navigation Buttons
            int leftOffset = 210;

            btnAdmin = CreateNavButton("👑 Admin Portal", leftOffset, (s, e) => NavigateTo("admin/"));
            leftOffset += btnAdmin.Width + 6;

            btnCrm = CreateNavButton("🏨 Front Desk", leftOffset, (s, e) => NavigateTo("hospitality"));
            leftOffset += btnCrm.Width + 6;

            btnRestaurant = CreateNavButton("🍽️ Restaurant", leftOffset, (s, e) => NavigateTo("restaurant"));
            leftOffset += btnRestaurant.Width + 6;

            btnBar = CreateNavButton("🍸 Bar", leftOffset, (s, e) => NavigateTo("bar"));
            leftOffset += btnBar.Width + 6;

            btnStore = CreateNavButton("📦 Store", leftOffset, (s, e) => NavigateTo("storeman"));
            leftOffset += btnStore.Width + 14;

            // Right utility buttons
            btnRefresh = new Button
            {
                Text = "🔄",
                Size = new Size(38, 36),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Location = new Point(this.ClientSize.Width - 360, 10),
                FlatStyle = FlatStyle.Flat,
                BackColor = ColorTranslator.FromHtml("#1E3A3F"),
                ForeColor = Color.White,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 10f)
            };
            btnRefresh.FlatAppearance.BorderSize = 0;
            btnRefresh.Click += (s, e) => { if (browser != null) browser.Refresh(); };

            btnEdgeApp = new Button
            {
                Text = "🚀 Open Full Window",
                Size = new Size(150, 36),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Location = new Point(this.ClientSize.Width - 314, 10),
                FlatStyle = FlatStyle.Flat,
                BackColor = ColorTranslator.FromHtml("#D97706"),
                ForeColor = Color.White,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold)
            };
            btnEdgeApp.FlatAppearance.BorderSize = 0;
            btnEdgeApp.Click += (s, e) => LaunchExternalAppWindow();

            btnSettings = new Button
            {
                Text = "⚙️ Cloud Settings",
                Size = new Size(130, 36),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Location = new Point(this.ClientSize.Width - 156, 10),
                FlatStyle = FlatStyle.Flat,
                BackColor = ColorTranslator.FromHtml("#1E3A3F"),
                ForeColor = ColorTranslator.FromHtml("#38BDF8"),
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold)
            };
            btnSettings.FlatAppearance.BorderSize = 0;
            btnSettings.Click += (s, e) => ShowSettingsDialog();

            lblStatus = new Label
            {
                Text = "Detecting server...",
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = ColorTranslator.FromHtml("#94A3B8"),
                AutoSize = true,
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Location = new Point(this.ClientSize.Width - 520, 18)
            };

            topBar.Controls.Add(lblLogo);
            topBar.Controls.Add(btnAdmin);
            topBar.Controls.Add(btnCrm);
            topBar.Controls.Add(btnRestaurant);
            topBar.Controls.Add(btnBar);
            topBar.Controls.Add(btnStore);
            topBar.Controls.Add(lblStatus);
            topBar.Controls.Add(btnRefresh);
            topBar.Controls.Add(btnEdgeApp);
            topBar.Controls.Add(btnSettings);

            // Embedded Browser Control
            browser = new WebBrowser
            {
                Dock = DockStyle.Fill,
                ScriptErrorsSuppressed = true,
                IsWebBrowserContextMenuEnabled = true
            };

            this.Controls.Add(browser);
            this.Controls.Add(topBar);

            this.Resize += (s, e) =>
            {
                btnRefresh.Location = new Point(this.ClientSize.Width - 360, 10);
                btnEdgeApp.Location = new Point(this.ClientSize.Width - 314, 10);
                btnSettings.Location = new Point(this.ClientSize.Width - 156, 10);
                lblStatus.Location = new Point(this.ClientSize.Width - 540, 18);
            };
        }

        private Button CreateNavButton(string text, int left, EventHandler onClick)
        {
            var btn = new Button
            {
                Text = text,
                AutoSize = true,
                Height = 36,
                Location = new Point(left, 10),
                FlatStyle = FlatStyle.Flat,
                BackColor = ColorTranslator.FromHtml("#1E3A3F"),
                ForeColor = Color.White,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Padding = new Padding(10, 0, 10, 0)
            };
            btn.FlatAppearance.BorderSize = 0;
            btn.Click += onClick;
            return btn;
        }

        private void HighlightActiveButton(string path)
        {
            Color activeColor = ColorTranslator.FromHtml("#0284C7");
            Color inactiveColor = ColorTranslator.FromHtml("#1E3A3F");

            btnAdmin.BackColor = path.StartsWith("admin") ? activeColor : inactiveColor;
            btnCrm.BackColor = path.StartsWith("hospitality") ? activeColor : inactiveColor;
            btnRestaurant.BackColor = path.StartsWith("restaurant") ? activeColor : inactiveColor;
            btnBar.BackColor = path.StartsWith("bar") ? activeColor : inactiveColor;
            btnStore.BackColor = path.StartsWith("store") ? activeColor : inactiveColor;
        }

        private void DetectBestConnectionAndNavigate()
        {
            lblStatus.Text = "Testing hotel connection...";
            lblStatus.ForeColor = ColorTranslator.FromHtml("#F59E0B");

            ThreadPool.QueueUserWorkItem((_) =>
            {
                bool localAvailable = CheckUrl("http://" + localHotelIp + "/api/health", 400);

                this.Invoke((MethodInvoker)delegate
                {
                    if (localAvailable)
                    {
                        currentBaseUrl = "http://" + localHotelIp;
                        isCloudMode = false;
                        lblStatus.Text = "🏢 Hotel Wi-Fi Connected";
                        lblStatus.ForeColor = ColorTranslator.FromHtml("#10B981");
                    }
                    else
                    {
                        currentBaseUrl = remoteCloudUrl.TrimEnd('/');
                        isCloudMode = true;
                        lblStatus.Text = "🌐 Worldwide Cloud Active";
                        lblStatus.ForeColor = ColorTranslator.FromHtml("#38BDF8");
                    }

                    NavigateTo(currentPath);
                });
            });
        }

        private bool CheckUrl(string url, int timeoutMs)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = timeoutMs;
                req.Method = "HEAD";
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK || (int)res.StatusCode < 400;
                }
            }
            catch
            {
                return false;
            }
        }

        private void NavigateTo(string path)
        {
            currentPath = path;
            HighlightActiveButton(path);

            if (string.IsNullOrEmpty(currentBaseUrl)) return;

            string fullUrl = currentBaseUrl.TrimEnd('/') + "/" + path.TrimStart('/');
            browser.Navigate(fullUrl);
        }

        private void LaunchExternalAppWindow()
        {
            string fullUrl = (currentBaseUrl.TrimEnd('/') + "/" + currentPath.TrimStart('/'));

            // Look for Edge executable
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            if (!File.Exists(edgePath))
            {
                edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
            }

            if (File.Exists(edgePath))
            {
                Process.Start(edgePath, string.Format("--app=\"{0}\" --window-size=1440,900", fullUrl));
            }
            else
            {
                Process.Start(fullUrl);
            }
        }

        private void ShowSettingsDialog()
        {
            using (var dlg = new Form())
            {
                dlg.Text = "Hotel City Park - Connection Settings";
                dlg.Size = new Size(500, 360);
                dlg.StartPosition = FormStartPosition.CenterParent;
                dlg.FormBorderStyle = FormBorderStyle.FixedDialog;
                dlg.MaximizeBox = false;
                dlg.MinimizeBox = false;
                dlg.BackColor = ColorTranslator.FromHtml("#0F2A2E");
                dlg.ForeColor = Color.White;

                var lbl1 = new Label { Text = "Worldwide Cloud URL (Accessible from Anywhere):", Location = new Point(20, 20), AutoSize = true, Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
                var txtCloud = new TextBox { Text = remoteCloudUrl, Location = new Point(20, 44), Width = 440, Font = new Font("Segoe UI", 9.5f), BackColor = ColorTranslator.FromHtml("#1E293B"), ForeColor = Color.White };

                var lbl2 = new Label { Text = "Local Hotel Wi-Fi IP / Host:", Location = new Point(20, 86), AutoSize = true, Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
                var txtLocal = new TextBox { Text = localHotelIp, Location = new Point(20, 110), Width = 440, Font = new Font("Segoe UI", 9.5f), BackColor = ColorTranslator.FromHtml("#1E293B"), ForeColor = Color.White };

                var btnQuickLocal = new Button { Text = "🏢 Set 10.160.83.195", Location = new Point(20, 150), Size = new Size(140, 30), FlatStyle = FlatStyle.Flat, BackColor = ColorTranslator.FromHtml("#1E3A3F"), ForeColor = Color.White };
                btnQuickLocal.Click += (s, e) => txtLocal.Text = "10.160.83.195:3000";

                var btnQuickCloud = new Button { Text = "🌐 Reset Cloud URL", Location = new Point(170, 150), Size = new Size(140, 30), FlatStyle = FlatStyle.Flat, BackColor = ColorTranslator.FromHtml("#1E3A3F"), ForeColor = Color.White };
                btnQuickCloud.Click += (s, e) => {
                    try {
                        if (File.Exists("remote_url.txt")) txtCloud.Text = File.ReadAllText("remote_url.txt").Trim();
                    } catch { }
                };

                var btnSave = new Button { Text = "Save & Connect", Location = new Point(320, 260), Size = new Size(140, 38), FlatStyle = FlatStyle.Flat, BackColor = ColorTranslator.FromHtml("#0284C7"), ForeColor = Color.White, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) };
                btnSave.Click += (s, e) =>
                {
                    remoteCloudUrl = txtCloud.Text.Trim();
                    localHotelIp = txtLocal.Text.Trim();
                    SaveConfig();
                    dlg.Close();
                    DetectBestConnectionAndNavigate();
                };

                dlg.Controls.Add(lbl1);
                dlg.Controls.Add(txtCloud);
                dlg.Controls.Add(lbl2);
                dlg.Controls.Add(txtLocal);
                dlg.Controls.Add(btnQuickLocal);
                dlg.Controls.Add(btnQuickCloud);
                dlg.Controls.Add(btnSave);

                dlg.ShowDialog(this);
            }
        }

        private void LoadConfig()
        {
            try
            {
                if (File.Exists("remote_url.txt"))
                {
                    string txt = File.ReadAllText("remote_url.txt").Trim();
                    if (!string.IsNullOrEmpty(txt) && txt.StartsWith("http"))
                    {
                        remoteCloudUrl = txt;
                    }
                }
            }
            catch { }

            try
            {
                string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HotelCityParkAdmin");
                string cfgFile = Path.Combine(appData, "config.ini");
                if (File.Exists(cfgFile))
                {
                    string[] lines = File.ReadAllLines(cfgFile);
                    foreach (var line in lines)
                    {
                        if (line.StartsWith("RemoteCloudUrl=")) remoteCloudUrl = line.Substring("RemoteCloudUrl=".Length).Trim();
                        if (line.StartsWith("LocalHotelIp=")) localHotelIp = line.Substring("LocalHotelIp=".Length).Trim();
                    }
                }
            }
            catch { }
        }

        private void SaveConfig()
        {
            try
            {
                string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HotelCityParkAdmin");
                if (!Directory.Exists(appData)) Directory.CreateDirectory(appData);

                string cfgFile = Path.Combine(appData, "config.ini");
                File.WriteAllLines(cfgFile, new string[]
                {
                    "RemoteCloudUrl=" + remoteCloudUrl,
                    "LocalHotelIp=" + localHotelIp
                });
            }
            catch { }
        }
    }
}
