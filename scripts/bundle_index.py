#!/usr/bin/env python3
"""
Builds index.html and dist/app-bundle.js from the clean modular ES source files in src/*.js.
By wrapping each module in its own isolated lexical IIFE inside <script type="module">
while importing Three.js r160 via the pinned importmap, index.html runs with ZERO
CORS errors both over http://localhost and directly over file://!
"""

import os
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT_DIR, "src")
DIST_DIR = os.path.join(ROOT_DIR, "dist")


def strip_es_module_syntax(code: str, is_main: bool = False) -> str:
    # Remove multi-line or single-line import statements
    code = re.sub(
        r"^\s*import\s+[\s\S]*?from\s+['\"][^'\"]+['\"];?\s*$",
        "",
        code,
        flags=re.MULTILINE,
    )
    # Remove export default ...
    code = re.sub(r"^\s*export\s+default\s+[^;]+;?\s*$", "", code, flags=re.MULTILINE)
    # Replace export const/let/var/function/class with const/let/var/function/class
    code = re.sub(
        r"^(\s*)export\s+(const|let|var|function|class)\b",
        r"\1\2",
        code,
        flags=re.MULTILINE,
    )
    if is_main:
        preamble = """
const {
  ARENA_CONSTANTS,
  BOOST_PAD_LAYOUT,
  evalArenaSDF,
  createArenaEnvironment
} = window.RLModules.Arena;
const {
  DEFAULT_LOFT_STATIONS,
  createLoftedShellGeometry,
  generateCarLiveryTexture,
  createBattleCarMesh,
  updateBattleCarVisuals,
  setExplodedView,
  createSoccerBallMesh,
  updateSoccerBallVisuals,
  setupStudioInspectionScene
} = window.RLModules.Assets;
const {
  PhysicsWorld,
  MATCH_STATES,
  MOVEMENTS_MANIFEST
} = window.RLModules.Physics;
const {
  CameraDirector,
  VFXManager,
  AudioSynthesizer,
  ReplaySystem,
  HUDController
} = window.RLModules.Presentation;
"""
        code = preamble + "\n" + code
    return code


def build_bundle() -> str:
    modules = [
        ("Module 1: Arena & Environment", "arena-and-environment.js", False),
        ("Module 2: Vehicles & Geodesic Ball", "vehicles-and-ball.js", False),
        ("Module 3: 6-DOF Physics, SDF & 4-Phase Kinematics", "physics-and-kinematics.js", False),
        ("Module 4: Camera Director, VFX, Web Audio, Replay & HUD", "vfx-audio-and-ui.js", False),
        ("Module 5: Master Orchestrator", "main.js", True),
    ]

    parts = [
        "import * as THREE from 'three';",
        "window.THREE = THREE;",
        "window.RLModules = window.RLModules || {};",
    ]

    for title, filename, is_main in modules:
        path = os.path.join(SRC_DIR, filename)
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
        transformed = strip_es_module_syntax(raw, is_main=is_main)
        parts.append(
            f"\n// ============================================================================\n"
            f"// {title} ({filename})\n"
            f"// ============================================================================\n"
            f"(function(THREE, THREE_IMPORT) {{\n{transformed}\n}})(THREE, THREE);\n"
        )

    return "\n".join(parts)


def main():
    os.makedirs(DIST_DIR, exist_ok=True)
    bundle_js = build_bundle()

    dist_bundle_path = os.path.join(DIST_DIR, "app-bundle.js")
    with open(dist_bundle_path, "w", encoding="utf-8") as f:
        f.write(bundle_js)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7' fill='%230088ff'/></svg>" />
  <title>OCTANE-RLX // DFH Neo-Dome Vehicular Soccer</title>
  <style>
    *, *::before, *::after {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}
    html, body {{
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #060b14;
      color: #f4f8ff;
      font-family: 'Chakra Petch', 'Rajdhani', system-ui, -apple-system, sans-serif;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }}
    #app {{
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }}
  </style>
  <script type="importmap">
  {{
    "imports": {{
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }}
  }}
  </script>
</head>
<body>
  <div id="app"></div>
  <div id="hud-root"></div>
  <script type="module">
{bundle_js}
  </script>
</body>
</html>
"""

    index_path = os.path.join(ROOT_DIR, "index.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Successfully generated {index_path} ({len(html)} bytes) and {dist_bundle_path} ({len(bundle_js)} bytes)")


if __name__ == "__main__":
    main()
