#!/bin/zsh
source "${0:a:h}/lib.zsh"
if [ "$OS" = windows ]; then
  MSYS_NO_PATHCONV=1 taskkill.exe /IM tc4_dev_server.exe /F && echo "rig server stopped" || echo "rig server was not running"
else
  pkill -f tc4_dev_server && echo "rig server stopped" || echo "rig server was not running"
fi
