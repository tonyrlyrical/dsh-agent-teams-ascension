param(
    [string]$InputPath = "evidence/desktop-validation/screenshots/harness-window-01.png",
    [string]$OutputPath = "evidence/desktop-validation/screenshots/crop-sidebar.png",
    [int]$X = 0,
    [int]$Y = 100,
    [int]$Width = 300,
    [int]$Height = 300
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile([System.IO.Path]::GetFullPath($InputPath))
$crop = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($crop)
$rect = New-Object System.Drawing.Rectangle $X, $Y, $Width, $Height
$g.DrawImage($src, 0, 0, $rect, [System.Drawing.GraphicsUnit]::Pixel)
$crop.Save([System.IO.Path]::GetFullPath($OutputPath), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$crop.Dispose()
$src.Dispose()

Write-Host "Cropped to $OutputPath"
