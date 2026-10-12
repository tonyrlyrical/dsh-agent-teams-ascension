Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile("D:\AGENTS TEAMS V2\evidence\desktop-validation\screenshots\harness-gui-21-staged-plan.png")
for ($y = 860; $y -le 960; $y += 5) {
    $c = $bmp.GetPixel(1300, $y)
    Write-Host "Y=${y} at X=1300: RGB($($c.R), $($c.G), $($c.B))"
}
$bmp.Dispose()
