$cookie = 'dsh-auth-KYe3so_aG3WgmUX39gtvk3d6RYvF1IG7HzEvXPITMI0=v1.eyJ2ZXJzaW9uIjoxLCJhdXRob3JpdHkiOiIxMjcuMC4wLjE6MTg5OTkiLCJpc3N1ZWRBdCI6MTc5MTc1ODM3ODIyMSwiZXhwaXJlc0F0IjoxNzk0MzUwMzc4MjIxfQ.h41KpmPvhbtQQUWqodZyf0kP8d2IwtxFgOROQE9WxjI'
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:18999/' -Headers @{ 'Cookie' = $cookie } -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
$lines = $r.Content -split "`n"
$title = $lines | Select-String '<title>' | Out-String
Write-Host "Title: $title"
Write-Host "Scripts:"
$lines | Select-String '<script' | Select-Object -First 10 | ForEach-Object { Write-Host $_ }
