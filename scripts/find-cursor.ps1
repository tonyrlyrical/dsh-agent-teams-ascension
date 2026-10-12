Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile("D:\AGENTS TEAMS V2\evidence\desktop-validation\screenshots\harness-gui-05-clicked-new-session.png")
for ($y = 520; $y -le 560; $y++) {
    $c = $bmp.GetPixel(618, $y)
    Write-Host "Y=$y : RGB($($c.R), $($c.G), $($c.B))"
}
$bmp.Dispose()
