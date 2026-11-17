set positional-arguments

# Launch Pi with this checkout in place of the configured pi-extensions package.
# Other configured packages stay loaded. Extra words are passed through to pi:
#   just pi
#   just pi --continue
pi *args:
    @bash scripts/pi-workspace.sh "$@"
