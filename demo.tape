# VHS Tape for Portki TUI Demo
# Run: vhs demo.tape to generate assets/preview.gif

Output assets/preview.gif

Require bun

Set Shell "bash"
Set FontSize 18
Set Width 1366
Set Height 768
Set Theme "Catppuccin Mocha"
Set Padding 20

# Start Portki TUI
Type "portki"
Enter
Sleep 3s

# Navigate listeners list
Down
Sleep 1s
Down
Sleep 1s

# Toggle Inspector Tabs (Details -> Connections -> Logs -> Details)
Type "l"
Sleep 2s
Type "l"
Sleep 2s
Type "l"
Sleep 2s

# Filter by application
Type "/"
Sleep 1s
Type "node"
Sleep 1.5s
Escape
Sleep 1s

# View Help Modal
Type "?"
Sleep 3s
Escape
Sleep 1s

# Quit Portki
Type "q"
Sleep 1s
