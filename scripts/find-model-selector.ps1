Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile("D:\AGENTS TEAMS V2\evidence\desktop-validation\screenshots\harness-gui-14-prompt-submitted.png")
Write-Host "Width: $($bmp.Width), Height: $($bmp.Height)"

# Find blue pixels (the up-arrow button has blue background #3b82f6 or similar)
for ($y = 800; $y -lt $bmp.Height; $y += 5) {
    for ($x = 500; $x -lt $bmp.Width; $x += 10) {
        $c = $bmp.GetPixel($x, $y)
        if ($c.B -gt 150 -and $c.R -lt 100) {
            Write-Host "Found blue button pixel at ($x, $y): RGB($($c.R), $($c.G), $($c.B))"
            break
        }
    }
}
$bmp.Dispose()
