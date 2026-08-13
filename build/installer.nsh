!macro customInstall
  DetailPrint "正在检查 / 安装 Visual C++ 运行库..."
  SetOutPath "$INSTDIR"
  File "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
  ExecWait '"$INSTDIR\vc_redist.x64.exe" /install /quiet /norestart' $0
  Delete "$INSTDIR\vc_redist.x64.exe"
!macroend
