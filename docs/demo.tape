# Records docs/demo.gif with VHS (https://github.com/charmbracelet/vhs):
#   vhs docs/demo.tape
# Run it from a demo repository that has a feature branch with a small,
# interesting change checked out, and Claude Code installed and logged in.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1280
Set Height 760
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Type "diff2ai doctor" Sleep 300ms Enter
Sleep 2.5s

Type "clear" Enter
Type "diff2ai --no-interactive --yes review --run claude --iterations 3 --then none" Sleep 300ms Enter
# consensus runs take a while; trim this pause in post if needed
Sleep 90s

Type "clear" Enter
Type "diff2ai post latest --dry-run | head -40" Sleep 300ms Enter
Sleep 6s

Type "diff2ai export latest --fail-on HIGH > /dev/null; echo exit=$?" Sleep 300ms Enter
Sleep 4s
