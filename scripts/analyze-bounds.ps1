Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile('D:\AGENTS TEAMS V2\evidence\desktop-validation\screenshots\dismiss-menu.png')
Write-Output "Dimensions: $($bmp.Width) x $($bmp.Height)"

$minX = 9999
$maxX = 0
$minY = 9999
$maxY = 0

for ($y = 480; $y -lt 700; $y += 5) {
    for ($x = 300; $x -lt 1600; $x += 5) {
        $c = $bmp.GetPixel($x, $y)
        # Background of main canvas is very dark (~18, 18, 18)
        # Composer box is lighter grey (~34, 34, 38)
        if ($c.R -gt 28 -and $c.R -lt 45 -and $c.G -gt 28 -and $c.G -lt 45) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}

Write-Output "Composer Card Bounds: X=[$minX, $maxX], Y=[$minY, $maxY]"
$bmp.Dispose()
