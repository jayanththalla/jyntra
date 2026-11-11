param(
    [string]$SourcePath = ".",
    [string]$ZipFile = "jyntra-source.zip"
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceFullPath = (Resolve-Path $SourcePath).Path
$zipFullPath = Join-Path $sourceFullPath $ZipFile

if (Test-Path $zipFullPath) {
    Remove-Item $zipFullPath -Force
    Write-Host "Removed existing archive: $zipFullPath"
}

$excludeDirNames = @('node_modules', '.next', '.cache', '.git')
$excludeFileExtensions = @('.zip')

Write-Host "Scanning files in: $sourceFullPath"

$zipArchive = [System.IO.Compression.ZipFile]::Open($zipFullPath, [System.IO.Compression.ZipArchiveMode]::Create)

$allFiles = Get-ChildItem -Path $sourceFullPath -Recurse -File -Force

$addedCount = 0
$totalBytes = 0

try {
    foreach ($file in $allFiles) {
        $relativePath = $file.FullName.Substring($sourceFullPath.Length).TrimStart('\', '/')
        
        # Check if file is inside an excluded directory
        $parts = $relativePath.Split([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
        $skip = $false
        foreach ($part in $parts) {
            if ($excludeDirNames -contains $part) {
                $skip = $true
                break
            }
        }
        
        # Check if file has excluded extension or is the zip itself
        if ($file.FullName -eq $zipFullPath -or $excludeFileExtensions -contains $file.Extension.ToLower()) {
            $skip = $true
        }

        if (-not $skip) {
            # Normalize path for zip entry (forward slashes)
            $entryName = $relativePath.Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            $addedCount++
            $totalBytes += $file.Length
        }
    }
}
finally {
    $zipArchive.Dispose()
}

$zipFileInfo = Get-Item $zipFullPath
$zipSizeMb = [math]::Round($zipFileInfo.Length / 1MB, 2)
$uncompressedSizeMb = [math]::Round($totalBytes / 1MB, 2)

Write-Host "=========================================="
Write-Host "Archive created successfully!"
Write-Host "Location: $zipFullPath"
Write-Host "Files included: $addedCount"
Write-Host "Uncompressed size: $uncompressedSizeMb MB"
Write-Host "Archive size: $zipSizeMb MB"
Write-Host "=========================================="
