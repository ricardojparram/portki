# VHS Tape for Portki TUI Demo
# Run: vhs demo.tape to generate assets/preview.gif

Output assets/preview.gif

Require portki

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set Padding 20
Set CornerRadius 10

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
