; -----------------------------------------------------------------------------
; NullTrace Portable NSIS Launcher Template
;
; Compiled by scripts/build-portable.mjs, which substitutes the handlebars values below.
; Tauri's own Windows bundler can only produce installers, so a single-file portable
; artefact needs its own launcher: this one extracts and runs, and installs nothing.
;
; Contract:
;   * nothing is written to Program Files, the registry, or the Start Menu;
;   * PORTABLE_EXECUTABLE_DIR is set to $EXEDIR — the directory the operator actually
;     ran this .exe from. src/main/config.ts (isPortableMode/portableBaseDir) resolves
;     the data directory from it, which is what makes the folder relocatable: move the
;     .exe and its data/ moves with it;
;   * the payload is a deliberate file list, not a recursive directory copy. An earlier
;     `File /r` over dist/ packed ~4200 files (86 MB of vendored dependencies alone),
;     producing a 218 MB artefact and a solid-compression pass that never finished.
; -----------------------------------------------------------------------------

Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

; zlib, not lzma-solid: the payload is thousands of small files and a solid pass over them
; is both slow and barely smaller.
SetCompressor /SOLID "zlib"

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh

!define PRODUCTNAME "NullTrace"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version}}.0"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define NODEBINARYSRCPATH "{{node_binary_path}}"
!define OUTFILE "{{out_file}}"
!define KEYRINGSRCPATH "{{keyring_path}}"

; The launcher IS the file the operator sees and double-clicks, so it has to wear the
; product mark. Without this directive NSIS compiles its own default (`modern-install.ico`)
; into the exe: the shell inside carried the brand icon while the launcher around it did
; not. MUI would have applied `MUI_ICON` for us, but `MUI_INSERT` only runs when a page
; macro is inserted, and this installer is silent and has no pages.
!define ICONPATH "{{icon_path}}"

Name "${PRODUCTNAME} Portable"
OutFile "${OUTFILE}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
Icon "${ICONPATH}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME} Portable"
VIAddVersionKey "FileDescription" "${PRODUCTNAME} Portable"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

Section "Main"
  SetOutPath "$LOCALAPPDATA\NullTrace\portable\${VERSION}"

  File "/oname=${MAINBINARYNAME}.exe" "${MAINBINARYSRCPATH}"
  File "/oname=node.exe" "${NODEBINARYSRCPATH}"

  ; Release keyring for artifact verification (resolve_keyring_path checks resources/release-keyring.json)
  CreateDirectory "$LOCALAPPDATA\NullTrace\portable\${VERSION}\resources"
  SetOutPath "$LOCALAPPDATA\NullTrace\portable\${VERSION}\resources"
  File "/oname=release-keyring.json" "${KEYRINGSRCPATH}"

  ; Built backend + renderer, one file at a time (see the header for why).
{{#each dist_files}}
{{this}}
{{/each}}

  ; Built MCP server distribution
{{#each mcp_files}}
{{this}}
{{/each}}

  ; Vendored production dependencies the backend resolves at runtime.
{{#each dist_node_modules}}
{{this}}
{{/each}}

  ; Relocatable data: config.ts resolves DATA_DIR from this variable.
  System::Call 'Kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_DIR", t "$EXEDIR")'
  ; Self-update target: an in-app update must replace the launcher (the file the operator owns
  ; in their application folder), not the extracted shell under %LOCALAPPDATA%\NullTrace\portable\<version>\.
  System::Call 'Kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_FILE", t "$EXEPATH")'
  ; Working directory must be the extracted root, or the shell resolves dist/ relative
  ; to wherever the launcher happened to be invoked from.
  SetOutPath "$LOCALAPPDATA\NullTrace\portable\${VERSION}"
  Exec '"$LOCALAPPDATA\NullTrace\portable\${VERSION}\${MAINBINARYNAME}.exe"'
SectionEnd
