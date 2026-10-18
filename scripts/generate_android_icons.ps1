Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Aamir Delta\city_backup\release-electron\Hotel City Park CRM-win32-x64\waiter-pannel\public\logo.png"
$resBase = "C:\Aamir Delta\city_backup\release-electron\Hotel City Park CRM-win32-x64\waiter-pannel\android\app\src\main\res"

if (-not (Test-Path $srcPath)) {
    Write-Error "Logo file not found at $srcPath"
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

function Resize-ImageCentered {
    param(
        [System.Drawing.Image]$source,
        [int]$targetWidth,
        [int]$targetHeight,
        [string]$outputPath,
        [bool]$makeRound = $false,
        [float]$paddingRatio = 0.12
    )

    $bmp = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # Compute aspect-fitted size with padding
    $availW = $targetWidth * (1.0 - 2 * $paddingRatio)
    $availH = $targetHeight * (1.0 - 2 * $paddingRatio)

    $srcRatio = $source.Width / $source.Height
    $targetRatio = $availW / $availH

    if ($srcRatio -gt $targetRatio) {
        $destW = [int]$availW
        $destH = [int]($availW / $srcRatio)
    } else {
        $destH = [int]$availH
        $destW = [int]($availH * $srcRatio)
    }

    $destX = [int](($targetWidth - $destW) / 2)
    $destY = [int](($targetHeight - $destH) / 2)

    if ($makeRound) {
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddEllipse(0, 0, $targetWidth, $targetHeight)
        $g.SetClip($path)
    }

    $g.DrawImage($source, $destX, $destY, $destW, $destH)
    $g.Dispose()

    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$densities = @(
    @{ folder = "mipmap-mdpi"; size = 48; fgSize = 108 },
    @{ folder = "mipmap-hdpi"; size = 72; fgSize = 162 },
    @{ folder = "mipmap-xhdpi"; size = 96; fgSize = 216 },
    @{ folder = "mipmap-xxhdpi"; size = 144; fgSize = 324 },
    @{ folder = "mipmap-xxxhdpi"; size = 192; fgSize = 432 }
)

foreach ($d in $densities) {
    $dir = Join-Path $resBase $d.folder
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    # Standard Icon
    $iconPath = Join-Path $dir "ic_launcher.png"
    Resize-ImageCentered -source $srcImg -targetWidth $d.size -targetHeight $d.size -outputPath $iconPath -makeRound $false -paddingRatio 0.08
    Write-Host "Generated $iconPath ($($d.size)x$($d.size))"

    # Round Icon
    $roundPath = Join-Path $dir "ic_launcher_round.png"
    Resize-ImageCentered -source $srcImg -targetWidth $d.size -targetHeight $d.size -outputPath $roundPath -makeRound $true -paddingRatio 0.08
    Write-Host "Generated $roundPath ($($d.size)x$($d.size))"

    # Foreground Icon
    $fgPath = Join-Path $dir "ic_launcher_foreground.png"
    Resize-ImageCentered -source $srcImg -targetWidth $d.fgSize -targetHeight $d.fgSize -outputPath $fgPath -makeRound $false -paddingRatio 0.18
    Write-Host "Generated $fgPath ($($d.fgSize)x$($d.fgSize))"
}

# Splash screen
$drawableDir = Join-Path $resBase "drawable"
$splashPath = Join-Path $drawableDir "splash.png"
Resize-ImageCentered -source $srcImg -targetWidth 480 -targetHeight 480 -outputPath $splashPath -makeRound $false -paddingRatio 0.15
Write-Host "Generated $splashPath"

$srcImg.Dispose()
Write-Host "All Android icons and splash assets successfully generated from public/logo.png!"
