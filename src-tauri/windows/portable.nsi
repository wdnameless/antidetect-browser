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
; The extraction root, BESIDE the launcher rather than under %LOCALAPPDATA%, so the operator's
; folder is self-contained. Defined here at file scope because the build script substitutes
; `CreateDirectory`/`SetOutPath` lines that reference it.
!define RUNTIME_DIR "$EXEDIR\runtime\${VERSION}"

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
  ; Everything the application needs lives INSIDE the folder the operator copied.
  ;
  ; It used to extract to `%LOCALAPPDATA%\NullTrace\portable\<version>`, which is a directory in
  ; the system that the folder being moved does not contain: copy the launcher to a USB stick and
  ; the new machine re-extracts there, leaving a second copy behind and — more importantly —
  ; making the operator's folder not self-contained. Measured before this change: a launch from a
  ; fresh folder grew `%LOCALAPPDATA%\NullTrace\portable\0.6.17` while the folder itself held only
  ; the launcher.
  ;
  ; Extracting beside the launcher means the payload, the data, the settings and the webview cache
  ; all sit under one directory that can be copied whole.
  ;
  ; The version is part of the path so an older extraction cannot be mistaken for the current one
  ; after an in-app update replaces the launcher.
  ;
  ; `RUNTIME_DIR` is defined at the top of this file, outside the section: the generated
  ; `CreateDirectory`/`SetOutPath` lines the build script substitutes reference it too, and a
  ; define inside a section is not visible to text substituted before it.

  ; Skip the extraction when this version is already unpacked. Re-extracting ~200 files on every
  ; launch is what made a start take the better part of a minute; the marker file is written last,
  ; so its presence means the previous extraction completed rather than stopped halfway.
  IfFileExists "${RUNTIME_DIR}\.extracted" ExtractionDone 0

  SetOutPath "${RUNTIME_DIR}"

  File "/oname=${MAINBINARYNAME}.exe" "${MAINBINARYSRCPATH}"
  File "/oname=node.exe" "${NODEBINARYSRCPATH}"

  ; Release keyring for artifact verification (resolve_keyring_path checks resources/release-keyring.json)
  CreateDirectory "${RUNTIME_DIR}\resources"
  SetOutPath "${RUNTIME_DIR}\resources"
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

  ; Written last, so its presence proves the extraction completed.
  FileOpen $0 "${RUNTIME_DIR}\.extracted" w
  FileWrite $0 "${VERSION}"
  FileClose $0

  ExtractionDone:

  ; Relocatable data: config.ts resolves DATA_DIR from this variable.
  System::Call 'Kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_DIR", t "$EXEDIR")'
  ; Self-update target: an in-app update must replace the launcher (the file the operator owns
  ; in their application folder), not the extracted shell inside the runtime folder.
  System::Call 'Kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_FILE", t "$EXEPATH")'
  ; Working directory must be the extracted root, or the shell resolves dist/ relative
  ; to wherever the launcher happened to be invoked from.
  SetOutPath "${RUNTIME_DIR}"
  Exec '"${RUNTIME_DIR}\${MAINBINARYNAME}.exe"'
SectionEnd
