## Civil Three.js Simple (Z‑up)

A minimal, self‑contained demo for civil/roadway visualization using Three.js with a Z‑up world. It renders:

- Road centerline (line → arc → line) alignment in XY
- Procedural existing ground surface
- Roadway corridor mesh from a simple template with crossfall
- Daylight slopes (2H:1V) to intersect the ground
- Interactive cross‑section overlay at the mouse location near the alignment
- Interactive longitudinal profile overlay along the alignment


### Quick start

Prerequisites:

- Node.js 18+ (Vite 5 requires Node 18 or newer)

Install and run the dev server:

```bash
npm install
npm run dev
```

Build for production and preview the build:

```bash
npm run build
npm run preview
```


### Controls

- Orbit (rotate): left mouse drag
- Pan: right mouse drag (or middle mouse)
- Zoom: mouse wheel
- Toggle overlays: click the “Cross‑Section” and “Profile” buttons
- Drag overlays: grab the overlay header to move

- Cross‑Section overlay pan/zoom:
  - Wheel: zoom X around cursor
  - Shift + Wheel: adjust vertical exaggeration (Y)
  - Left‑drag inside plot: pan X and vertical center
  - Double‑click: reset view

- Profile overlay pan/zoom:
  - Wheel: zoom X around cursor
  - Shift + Wheel: zoom Y around cursor
  - Left‑drag inside plot: pan X and Y
  - Double‑click: reset view

- Profile overlay editing:
  - Right‑click inside plot: add an intermediate IP at cursor chainage
  - Drag start/end dots: adjust start/end elevations (vertical)
  - Drag intermediate dots: move left/right and up/down (clamped between neighbors)
  - Browser context menu is disabled on the profile canvas for smooth editing


### How it works (high‑level)

- Z‑up world: `THREE.Object3D.DEFAULT_UP.set(0, 0, 1)` in `src/main.ts`.
- Surface: `createSurfaceMesh()` in `src/surface.ts` generates a procedural XY grid and displaces Z by `heightAt(x, y)`.
- Alignment: `Alignment` in `src/alignment.ts` creates a simple polyline made of a line, an arc, and a line; provides nearest‑point queries and chainages.
- Roadway: `createRoadwayMeshFromTwoIPs()` in `src/roadway.ts` builds a corridor ribbon using a vertical profile. The profile defaults to a two‑IP straight line (start/end from surface) but supports a user‑edited piecewise‑linear grade (profile overlay IPs). Crossfall is applied per side and lane/shoulder.
- Daylight: `createDaylightMeshFromTwoIPs()` casts outward slopes (2H:1V) from road outer edges to intersect the existing ground.
- Cross‑section overlay: `CrossSectionOverlay` in `src/crossSection.ts` samples a section perpendicular to alignment at the current mouse location and draws the ground, roadway template, and daylight lines.
- Profile overlay: `ProfileOverlay` in `src/profile.ts` samples existing ground along alignment and overlays a piecewise‑linear design grade editable with IPs.


### Road template (design parameters)

Defined by `RoadTemplate` in `src/roadway.ts` and used throughout:

- `laneWidth` (m per side)
- `shoulderWidth` (m per side)
- `crossfallLane` (signed slope per side, applied inside lane width)
- `crossfallShoulder` (signed slope per side, applied outside lane width)

You can adjust the default values in `src/main.ts` where `roadTemplate` is created.


### Project structure

```text
civil-threejs-simple/
  index.html               # UI buttons, overlay containers, app root
  vite.config.ts           # Vite config (base './' for static hosting)
  tsconfig.json            # TS config (ES2022, strict)
  package.json             # Scripts: dev, build, preview
  src/
    main.ts                # App bootstrap (scene/camera/controls/lights/overlays)
    surface.ts             # Procedural surface + height function
    alignment.ts           # Alignment geometry and queries
    roadway.ts             # Road mesh/edges/daylight from template and two‑IP profile
    crossSection.ts        # Cross‑section overlay
    profile.ts             # Profile overlay
    sectionMarker.ts       # 3D bar + sphere marker for section location
    styles.css             # Minimal dark UI styling
    env.d.ts               # Three.js types reference
```


### Scripts

- `npm run dev`: start Vite dev server (auto‑open browser)
- `npm run build`: production build to `dist/`
- `npm run preview`: preview the built `dist/`


### Deployment

- The Vite config uses `base: './'`, so the `dist/` output can be served from any static host or subfolder (e.g., GitHub Pages). Upload the `dist/` directory as your site root.


### Development notes

- Grid is rotated to lie on the XY plane to match the Z‑up convention.
- Materials are translucent for visual layering of surface, roadway, and daylight.
- Cross‑section uses a vertical exaggeration (2×) for readability; horizontal scale matches section width.
- Cross‑section uses a default vertical exaggeration (2×), adjustable with Shift + wheel; horizontal scale matches section width.
- Daylight search uses a robust bisection‑style root find along outward normals; see `findDaylightIntersection()` in both `src/roadway.ts` and `src/crossSection.ts`.


### Changing geometry quickly

- Alignment geometry lives in `src/alignment.ts` (`sampleLine`, `sampleArc`). Modify points, radius, or samples to alter the centerline.
- Surface shape is controlled by `heightAt(x, y)` in `src/surface.ts`.
- Roadway template parameters are set in `src/main.ts`.


### Tech stack

- Three.js (`three`)
- TypeScript 5
- Vite 5


### License

No license specified. Add one if you plan to distribute.


