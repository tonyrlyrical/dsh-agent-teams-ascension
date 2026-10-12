Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile("D:\AGENTS TEAMS V2\evidence\desktop-validation\screenshots\harness-gui-28-economy-staged.png")
for ($y = 750; $y -le 900; $y += 5) {
    for ($x = 1000; $x -le 1600; $x += 20) {
        $c = $bmp.GetPixel($x, $y)
        if ($c.B -gt 180 -and $c.B -gt ($c.R + 40)) {
            Write-Host "Blue button pixel at ($x, $y): RGB($($c.R), $($c.G), $($c.B))"
            break
        }
    }
}
$bmp.Dispose()
