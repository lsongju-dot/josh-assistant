param(
  [Parameter(Mandatory = $true)]
  [string]$RepoName,

  [string]$Description = "조쉬 - 스케줄 및 금전 관리 비서",
  [switch]$Private
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git 명령을 찾을 수 없습니다. Git for Windows를 먼저 설치해주세요."
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "gh 명령을 찾을 수 없습니다. GitHub CLI를 먼저 설치하고 'gh auth login'을 실행해주세요."
}

$visibility = if ($Private) { "--private" } else { "--public" }

if (-not (Test-Path .git) -or -not (Get-ChildItem .git -Force -ErrorAction SilentlyContinue)) {
  git init
}

git add index.html manifest.webmanifest sw.js icon.svg .nojekyll README.md publish-github-pages.ps1
git commit -m "Publish Josh assistant app" 2>$null

$repoExists = $true
gh repo view $RepoName 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  $repoExists = $false
}

if (-not $repoExists) {
  gh repo create $RepoName $visibility --description $Description --source . --remote origin --push
} else {
  git remote remove origin 2>$null
  $owner = gh api user --jq ".login"
  git remote add origin "https://github.com/$owner/$RepoName.git"
  git branch -M main
  git push -u origin main
}

gh api -X POST "repos/:owner/$RepoName/pages" -f source.branch=main -f source.path=/ 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  gh api -X PUT "repos/:owner/$RepoName/pages" -f source.branch=main -f source.path=/ 1>$null
}

$owner = gh api user --jq ".login"
"https://$owner.github.io/$RepoName/"
